const path = require('node:path');
process.loadEnvFile(path.join(__dirname, '..', '.env'));

async function setup() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const targetKey = process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY;
  const adminKey = process.env.CLOUDINARY_SETUP_API_KEY;
  const adminSecret = process.env.CLOUDINARY_SETUP_API_SECRET;
  if (!cloud || !targetKey || !adminKey || !adminSecret) {
    throw new Error('Add CLOUDINARY_SETUP_API_KEY and CLOUDINARY_SETUP_API_SECRET locally for one-time folder setup.');
  }
  const base = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}`;
  const authorization = `Basic ${Buffer.from(`${adminKey}:${adminSecret}`).toString('base64')}`;
  async function request(endpoint, method = 'GET', body) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Folder setup request failed (HTTP ${response.status}). Check administrative access.`);
    return response.json();
  }
  const searchPath = '/folders/search?expression=' + encodeURIComponent('path="shoppy/products"');
  let result = await request(searchPath);
  let folder = result.folders.find(item => item.path === 'shoppy/products');
  if (!folder) {
    await request('/folders/shoppy/products', 'POST');
    result = await request(searchPath);
    folder = result.folders.find(item => item.path === 'shoppy/products');
  }
  if (!folder?.external_id) throw new Error('Could not resolve the shoppy/products folder ID.');
  await request(`/folder_operations/invite/${encodeURIComponent(folder.external_id)}`, 'POST', {
    principal: { id: targetKey, type: 'apiKey' },
    operation: 'add',
    roles: ['cld::role::content::folder::editor'],
  });
  console.log('Editor access assigned to the application key for shoppy/products.');
  console.log('Remove the CLOUDINARY_SETUP variables from .env, then run npm run check:cloudinary.');
}
setup().catch(error => { console.error(error.message); process.exitCode = 1; });
