import axios from 'axios';

// Use VITE_API_BASE_URL in production (direct to backend, bypasses Vite proxy)
// Leave unset in dev — Vite proxy handles routing
const baseURL = import.meta.env.VITE_API_BASE_URL ?? '';

const client = axios.create({
  baseURL,
  headers: {
    'Accept': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (!isLoginRequest && (error.response?.status === 401 || error.response?.status === 403)) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default client;
