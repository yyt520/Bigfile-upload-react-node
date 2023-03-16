import React, { useRef, useEffect, useReducer } from 'react';
import { Button, Progress, message } from 'antd';
import SparkMD5 from 'spark-md5';
import './style.css';
import axios from 'axios';

const baseUrl = 'http://localhost:1111';

const initialState = {
  checkPercentList: [
    // {
    //   name: '',
    //   progress: 0,
    // },
  ],
  uploadPercentList: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'clearAll':
      // 每次出发input file的事件，则清空上传历史记录
      initialState.checkPercentList = [];
      initialState.uploadPercentList = [];
      return { ...initialState };

    case 'init':
      let index = initialState.checkPercentList.findIndex(
        (c) => c.name === action.name
      );
      if (index === -1) {
        initialState.checkPercentList.push({
          name: action.name,
          p: 0,
        });
        initialState.uploadPercentList.push({
          name: action.name,
          p: 0,
        });
      }
      return { ...initialState };

    case 'check':
      initialState.checkPercentList.forEach((c) => {
        if (c.name === action.name) {
          c.progress = action.progress;
        }
      });

      return { ...initialState };
    case 'upload':
      console.log('upload------', action);
      initialState.uploadPercentList.forEach((c) => {
        if (c.name === action.name) {
          c.progress = action.progress;
        }
      });

      return { ...initialState };
    default:
      return {
        checkPercentList: [],
        uploadPercentList: [],
      };
  }
}

const UploadMultiple = () => {
  // const renderRef = useRef(true); // 解决 useEffect 调用俩次的
  const [state, dispatch] = useReducer(reducer, initialState);
  const inputRef = useRef(null);
  const chunks = 100; // 切成100份
  const chunkSize = 5 * 1024 * 1024; // 切片大小

  let uploadCurrentChunk = 0; // 上传，当前切片

  /**
   * 将文件转换成md5并进行切片
   * @returns md5
   */
  const md5File = (file) => {
    return new Promise((resolve, reject) => {
      let checkCurrentChunk = 0; // 检查，当前切片

      // 文件截取
      let blobSlice =
          File.prototype.slice ||
          File.prototype.mozSlice ||
          File.prototype.webkitSlice,
        chunkSize = file?.size / 100,
        spark = new SparkMD5.ArrayBuffer(),
        fileReader = new FileReader();

      fileReader.onload = function (e) {
        console.log('read chunk nr', checkCurrentChunk + 1, 'of', chunks);
        spark.append(e.target.result);
        checkCurrentChunk += 1;

        if (checkCurrentChunk < chunks) {
          loadNext();
        } else {
          let result = spark.end();
          resolve(result);
        }
      };

      fileReader.onerror = function () {
        message.error('文件读取错误');
      };

      const loadNext = () => {
        const start = checkCurrentChunk * chunkSize,
          end = start + chunkSize >= file.size ? file.size : start + chunkSize;

        // 文件切片
        fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
        // 检查进度条
        dispatch({
          type: 'check',
          name: file.name,
          progress: checkCurrentChunk + 1,
        });
      };

      loadNext();
    });
  };

  /**
   * 校验文件
   * @param {*} fileName 文件名
   * @param {*} fileMd5Value md5文件
   * @returns
   */
  const checkFileMD5 = (fileName, fileMd5Value) => {
    let url = `${baseUrl}/check/file?fileName=${fileName}&fileMd5Value=${fileMd5Value}`;
    return axios.get(url);
  };

  // 上传chunk
  function upload({ i, file, fileMd5Value, chunks, startPercent = 0 }) {
    uploadCurrentChunk = startPercent; // 断点续传的片段不在上传
    //构造一个表单，FormData是HTML5新增的
    let end =
      (i + 1) * chunkSize >= file.size ? file.size : (i + 1) * chunkSize;
    let form = new FormData();
    form.append('data', file.slice(i * chunkSize, end)); //file对象的slice方法用于切出文件的一部分
    form.append('total', chunks); //总片数
    form.append('index', i); //当前是第几片
    form.append('fileMd5Value', fileMd5Value);
    return axios({
      method: 'post',
      url: `${baseUrl}/upload`,
      data: form,
    }).then(({ data }) => {
      if (data.stat) {
        uploadCurrentChunk = uploadCurrentChunk + 1;
        const uploadPercent = Math.ceil((uploadCurrentChunk / chunks) * 100);
        dispatch({ type: 'upload', progress: uploadPercent, name: file.name });
      }
    });
  }

  /**
   * 上传chunk
   * @param {*} fileMd5Value
   * @param {*} chunkList
   */
  async function checkAndUploadChunk(file, fileMd5Value, chunkList) {
    // console.log('chunkList', chunkList);
    let chunks = Math.ceil(file.size / chunkSize);
    const requestList = [];
    for (let i = 0; i < chunks; i++) {
      let exit = chunkList.indexOf(i + '') > -1;
      // 如果不存在，则上传
      if (!exit) {
        requestList.push(
          upload({
            i,
            file,
            fileMd5Value,
            chunks,
            startPercent: chunkList.length,
          })
        );
      }
    }

    // 并发上传
    if (requestList?.length) {
      await Promise.all(requestList);
    }
  }

  const responseChange = async (file) => {
    // 1.校验文件，返回md5
    const fileMd5Value = await md5File(file);
    // 2.校验文件的md5
    const { data } = await checkFileMD5(file.name, fileMd5Value);
    // 如果文件已存在, 就秒传
    if (data?.file) {
      message.success('文件已秒传');
      dispatch({
        type: 'upload',
        progress: 100,
        name: data.file.name.replace('nodeServer/uploads/', ''),
      });
      return;
    }
    // 3：检查并上传切片
    await checkAndUploadChunk(file, fileMd5Value, data.chunkList);
    // 4：通知服务器所有服务器分片已经上传完成
    notifyServer(file, fileMd5Value);
  };

  /**
   * 所有的分片上传完成，准备合成
   * @param {*} file
   * @param {*} fileMd5Value
   */
  function notifyServer(file, fileMd5Value) {
    let url = `${baseUrl}/merge?md5=${fileMd5Value}&fileName=${file.name}&size=${file.size}`;
    axios.get(url).then(({ data }) => {
      if (data.stat) {
        message.success('上传成功');
      } else {
        message.error('上传失败');
      }
    });
  }

  useEffect(() => {
    // if (renderRef.current) {
    //   renderRef.current = false;
    //   return;
    // }

    const changeFile = ({ target }) => {
      dispatch({ type: 'clearAll' });

      for (let i = 0; i < target.files.length; i++) {
        dispatch({ type: 'init', name: target.files[i].name });
        responseChange(target.files[i]);
      }
    };

    document.addEventListener('change', changeFile);

    return () => {
      dispatch({ type: 'clearAll' });
      document.removeEventListener('change', changeFile);
    };
  }, []);

  return (
    <div style={{ padding: 30 }}>
      <h1>
        React + Node 实现大文件分片上传、断点续传、秒传[多个文件]：
        <input ref={inputRef} type="file" id="file" multiple />
        <Button type="primary" onClick={() => inputRef.current.click()}>
          上传
        </Button>
      </h1>

      {state.checkPercentList.length > 0 && (
        <div>
          <h3 style={{ width: 200 }}>读取文件：</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {state.checkPercentList.map((c) => (
              <div style={{ width: '20%' }} key={c.name}>
                文件名：{c.name}
                <br />
                <Progress style={{ width: '90%' }} percent={c.progress} />
              </div>
            ))}
          </div>
        </div>
      )}

      {state.uploadPercentList.length > 0 && (
        <div>
          <h3 style={{ width: 200 }}>上传文件进度：</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {state.uploadPercentList.map((c) => (
              <div style={{ width: '20%' }} key={c.name}>
                文件名：{c.name}
                <br />
                <Progress style={{ width: '90%' }} percent={c.progress} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadMultiple;
