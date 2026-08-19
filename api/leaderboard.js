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

export default async function handler(req, res) {
  const apiKey = process.env.JSONBIN_API_KEY;
  const binId = process.env.JSONBIN_BIN_ID;

  if (!apiKey || !binId) {
    return sendJson(res, 500, { error: 'Variáveis de ambiente do JSONBin não configuradas.' });
  }

  const binUrl = `${JSONBIN_BASE_URL}/${binId}`;

  if (req.method === 'GET') {
    try {
      const response = await fetch(`${binUrl}/latest`, {
        headers: { 'X-Master-Key': apiKey }
      });

      if (!response.ok) {
        return sendJson(res, response.status, { error: 'Não foi possível carregar o placar.' });
      }

      const data = await response.json();
      const record = normalizeLeaderboard(data.record);
      return sendJson(res, 200, { record });
    } catch (error) {
      return sendJson(res, 500, { error: 'Erro ao buscar o placar.' });
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

    if (!nome || !token || !Number.isFinite(tempo) || tempo <= 0) {
      return sendJson(res, 400, { error: 'Nome, token e tempo são obrigatórios.' });
    }

    try {
      const response = await fetch(`${binUrl}/latest`, {
        headers: { 'X-Master-Key': apiKey }
      });

      if (!response.ok) {
        return sendJson(res, response.status, { error: 'Não foi possível ler o placar atual.' });
      }

      const data = await response.json();
      const placar = normalizeLeaderboard(data.record);
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

      placar.sort((a, b) => Number(b.tempo || 0) - Number(a.tempo || 0));
      const record = placar.slice(0, 10);

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
          return sendJson(res, 500, { error: 'Falha ao atualizar o placar.' });
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