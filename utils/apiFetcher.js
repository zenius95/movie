const fetch = require('node-fetch');
require('dotenv').config();

const API_BASE_URL = process.env.OPHIM_API_URL || 'https://ophim1.com/v1';

async function fetchApi(endpoint) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!response.ok) {
      // console.error(`API Error: ${response.status} for ${endpoint}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Fetch failed for ${endpoint}:`, error);
    return null;
  }
}

module.exports = { fetchApi };