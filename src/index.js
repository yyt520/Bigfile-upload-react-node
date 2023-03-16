import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Upload from './Upload';
import UploadMultiple from './UploadMultiple';
import 'antd/dist/antd.css';

ReactDOM.render(
  <BrowserRouter>
    <Routes>
      <Route path="/upload" element={<Upload />}></Route>
      {/* <Route path="/UploadMultiple" element={<UploadMultiple />}></Route> */}
      <Route path="/" element={<UploadMultiple />}></Route>
    </Routes>
  </BrowserRouter>,

  document.getElementById('root')
);
