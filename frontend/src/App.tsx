import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import HomePage from './pages/HomePage';
import ProcessingPage from './pages/ProcessingPage';
import ResultsPage from './pages/ResultsPage';
import ConceptReviewPage from './pages/ConceptReviewPage';
import PlanEditPage from './pages/PlanEditPage';
import ShortReviewPage from './pages/ShortReviewPage';
import LoginPage from './pages/LoginPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('auth_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
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
