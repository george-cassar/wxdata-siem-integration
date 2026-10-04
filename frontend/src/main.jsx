import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Theme } from '@carbon/react';
import { DemoProvider } from './context/DemoContext';
import App from './App';
import './index.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Theme theme="g90">
      <DemoProvider>
        <App />
      </DemoProvider>
    </Theme>
  </BrowserRouter>
);
