import axios from 'axios';

const client = axios.create({
  baseURL: '',
  headers: {
    'Accept': 'application/json',
  },
});

export default client;
