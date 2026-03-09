import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import HomePage from './pages/HomePage';
import ProcessingPage from './pages/ProcessingPage';
import ResultsPage from './pages/ResultsPage';
import ConceptReviewPage from './pages/ConceptReviewPage';
import PlanEditPage from './pages/PlanEditPage';
import ShortReviewPage from './pages/ShortReviewPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/processing/:jobId" element={<ProcessingPage />} />
          <Route path="/review/:jobId" element={<ConceptReviewPage />} />
          <Route path="/plan-edit/:jobId" element={<PlanEditPage />} />
          <Route path="/short-review/:jobId" element={<ShortReviewPage />} />
          <Route path="/results/:jobId" element={<ResultsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
