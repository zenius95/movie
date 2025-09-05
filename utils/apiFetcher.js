const fetch = require('node-fetch');
require('dotenv').config();

const API_BASE_URL = process.env.OPHIM_API_URL || 'https://ophim1.com/v1';

async function fetchApi(endpoint, agent = null) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { agent });
    if (!response.ok) {
      // Ném lỗi để logic retry có thể bắt được
      throw new Error(`API Error: ${response.status} for ${endpoint}`);
    }
    return await response.json();
  } catch (error) {
    // Ném lại lỗi để hàm gọi có thể xử lý
    throw error;
  }
}

module.exports = { fetchApi };