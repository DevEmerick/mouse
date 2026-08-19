const JSONBIN_BASE_URL = 'https://api.jsonbin.io/v3/b';

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

function normalizeLeaderboard(record) {
  return Array.isArray(record) ? record : [];
}

async function fetchLatestLeaderboard(binUrl, apiKey) {
  const response = await fetch(`${binUrl}/latest`, {
    headers: { 'X-Master-Key': apiKey }
  });

  if (response.ok) {
    const data = await response.json();
    return {
      record: normalizeLeaderboard(data.record),
      missing: false
    };
  }

  if (response.status === 404 || response.status === 204) {
    return {
      record: [],
      missing: true
    };
  }

  const errorText = await response.text().catch(() => '');
  const error = new Error(errorText || 'Não foi possível acessar o placar atual.');
  error.status = response.status;
  throw error;
}

export default async function handler(req, res) {
  const apiKey = process.env.JSONBIN_API_KEY;
  const binId = process.env.JSONBIN_BIN_ID;

  if (!apiKey || !binId) {
    return sendJson(res, 500, { error: 'Variáveis de ambiente do JSONBin não configuradas.' });
  }

  const binUrl = `${JSONBIN_BASE_URL}/${binId}`;

  if (req.method === 'GET') {
    try {
      const { record } = await fetchLatestLeaderboard(binUrl, apiKey);
      return sendJson(res, 200, { record });
    } catch (error) {
      const status = error.status && error.status >= 400 ? error.status : 500;
      const message = status === 401 || status === 403
        ? 'Acesso ao JSONBin negado. Verifique JSONBIN_API_KEY e JSONBIN_BIN_ID no ambiente da Vercel.'
        : 'Erro ao buscar o placar.';
      return sendJson(res, status, { error: message });
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let body;

    try {
      body = parseBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'Corpo da requisição inválido.' });
    }

    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const tempo = Number(body.tempo);
    const clientRecord = normalizeLeaderboard(body.record);

    if (!nome || !token || !Number.isFinite(tempo) || tempo <= 0) {
      return sendJson(res, 400, { error: 'Nome, token e tempo são obrigatórios.' });
    }

    try {
      let placar = clientRecord;

      try {
        const latest = await fetchLatestLeaderboard(binUrl, apiKey);
        placar = latest.record;
      } catch (error) {
        if (!placar.length) {
          throw error;
        }
      }

      const jogadorIndex = placar.findIndex((p) => p && p.nome === nome);
      let updated = false;
      let syncedTime = tempo;

      if (jogadorIndex >= 0) {
        const jogadorExistente = placar[jogadorIndex];
        const tokenAtual = typeof jogadorExistente.token === 'string' ? jogadorExistente.token : '';
        const tempoAtual = Number(jogadorExistente.tempo);

        if (tokenAtual && tokenAtual !== token) {
          return sendJson(res, 403, { error: 'Token inválido para este nome.' });
        }

        syncedTime = Number.isFinite(tempoAtual) ? tempoAtual : tempo;

        if (!Number.isFinite(tempoAtual) || tempo > tempoAtual) {
          placar[jogadorIndex] = {
            ...jogadorExistente,
            nome,
            tempo,
            token
          };
          updated = true;
          syncedTime = tempo;
        }
      } else {
        placar.push({ nome, tempo, token });
        updated = true;
      }

      const mergedRecord = [...placar];
      mergedRecord.sort((a, b) => Number(b.tempo || 0) - Number(a.tempo || 0));
      const record = mergedRecord.slice(0, 10);

      if (updated) {
        const putResponse = await fetch(binUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': apiKey
          },
          body: JSON.stringify(record)
        });

        if (!putResponse.ok) {
          const errorText = await putResponse.text().catch(() => '');
          return sendJson(res, 500, {
            error: errorText || 'Falha ao atualizar o placar.'
          });
        }
      }

      return sendJson(res, 200, {
        record,
        updated,
        syncedTime
      });
    } catch (error) {
      return sendJson(res, 500, { error: 'Erro ao salvar o placar.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return sendJson(res, 405, { error: 'Método não permitido.' });
}