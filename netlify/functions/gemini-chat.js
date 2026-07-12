// netlify/functions/gemini-chat.js
// Esta función corre en el servidor de Netlify, NUNCA en el navegador del usuario.
// La API key vive acá, oculta, leída desde una variable de entorno.

exports.handler = async (event) => {
  // Solo aceptamos POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  try {
    const { history, systemPrompt } = JSON.parse(event.body);

    const apiKey = process.env.GEMINI_API_KEY; // <- la key vive en Netlify, no en el código
    const MODEL_NAME = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const payload = {
      contents: history,
      systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || 'Error de Google' })
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Lo siento, tuve un problema al procesar tu solicitud.';

    return {
      statusCode: 200,
      body: JSON.stringify({ text })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
