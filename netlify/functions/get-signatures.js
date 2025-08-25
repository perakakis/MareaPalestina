const https = require('https');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get form submissions from Netlify API
    const siteId = process.env.NETLIFY_SITE_ID || context.clientContext?.custom?.netlify?.site_url?.split('//')[1]?.split('.')[0];
    const accessToken = process.env.NETLIFY_ACCESS_TOKEN;

    if (!accessToken) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Access token not configured' })
      };
    }

    const apiUrl = `https://api.netlify.com/api/v1/sites/${siteId}/submissions`;
    
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.netlify.com',
        path: `/api/v1/sites/${siteId}/submissions`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`API request failed: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });

    // Process submissions into signatory format
    const signatories = data
      .filter(submission => submission.data && submission.data.name)
      .map(submission => {
        const data = submission.data;
        
        // Parse commitments (they come as separate fields in Netlify)
        const commitments = [];
        Object.keys(data).forEach(key => {
          if (key.startsWith('commitment') && data[key]) {
            commitments.push(data[key]);
          }
        });

        return {
          name: data.name,
          affiliation: data.affiliation,
          department: data.department || '',
          commitments: commitments,
          additional: data.additional || '',
          date: new Date(submission.created_at).toLocaleDateString()
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // Most recent first

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ signatories })
    };

  } catch (error) {
    console.error('Error fetching signatures:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch signatures' })
    };
  }
};