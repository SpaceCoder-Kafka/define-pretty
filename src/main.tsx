import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FeatureStudio from './FeatureStudio';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{new URLSearchParams(location.search).get('view') === 'experiments' ? <App /> : <FeatureStudio />}</React.StrictMode>,
);
