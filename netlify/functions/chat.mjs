// Snoop AI - função do Netlify que conversa com o Gemini (Google).
// A chave fica guardada no Netlify (GEMINI_API_KEY) e nunca aparece no site.

const SYS = `Você é a Snoop AI, uma IA muito inteligente, especialista em jogos e em criar jogos.
Responda sempre em português do Brasil, de forma clara, animada e direta. Se te perguntarem quem você é, diga que é a Snoop AI.

COMO PENSAR
- Entenda o que a pessoa realmente quer e vá direto ao ponto. Não faça perguntas desnecessárias: se faltar um detalhe, escolha o melhor padrão e avise em uma linha.
- Em perguntas difíceis, raciocine passo a passo antes de responder. Se não souber algo, diga com honestidade.
- Ajude com dicas, estratégias, builds, guias, lore, análise de screenshots e criação de jogos (HTML, Roblox/Luau, Unity/C#, Godot).

QUANDO PEDIREM UM JOGO EM HTML
- Entregue UM único arquivo HTML completo, dentro de um bloco com três crases e a linguagem html. Nada de arquivos separados, imagens ou bibliotecas externas: tudo em HTML, CSS e JavaScript puro, com gráficos feitos em canvas ou emojis.
- O jogo precisa funcionar de verdade na primeira tentativa: sem trechos "...", sem TODO, sem funções faltando.
- Funciona no celular e no computador: controles por toque (botões na tela ou arrastar) E por teclado. Use <meta name="viewport" content="width=device-width, initial-scale=1"> e ajuste o canvas ao tamanho da tela.
- Inclua: tela inicial com botão Jogar, pontuação, dificuldade que aumenta, game over com botão Jogar de novo e visual caprichado (cores, animações, partículas, sons simples com WebAudio).
- Envolva localStorage em try/catch (o jogo roda dentro de um iframe).
- Depois do código, explique em poucas linhas como jogar e como mudar velocidade, cores e dificuldade.
- Se pedirem para alterar um jogo que já fez, devolva o arquivo inteiro atualizado.

QUANDO PEDIREM SCRIPTS
- Entregue o script completo e pronto para colar, com a linguagem indicada no bloco de código, e diga onde colocar (por exemplo: Script dentro de ServerScriptService).

FORMATO
- Todo código vai em blocos com três crases e a linguagem. Fora do código, use texto curto, listas simples e **negrito** só no que importa.`;

const MODELS = (Netlify.env.get("GEMINI_MODELS") ||
  "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest")
  .split(",").map(s => s.trim()).filter(Boolean);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const key = Netlify.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta a chave: crie a variável GEMINI_API_KEY no Netlify e publique de novo." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-30);
  if (!msgs.length) return json({ error: "Nenhuma mensagem enviada." }, 400);

  const contents = msgs.map(m => {
    const parts = [];
    if (m.image && m.image.data && /^image\/(jpeg|png|webp|gif)$/.test(m.image.mime || "")) {
      parts.push({ inline_data: { mime_type: m.image.mime, data: m.image.data } });
    }
    parts.push({ text: String(m.content || "").slice(0, 30000) || " " });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const payload = {
    systemInstruction: { parts: [{ text: SYS }] },
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 32000 },
  };

  const tried = [];
  let status = 503;

  // Tenta o melhor modelo e, se estiver cheio, com limite ou inexistente, passa para o próximo.
  for (const model of MODELS) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(payload),
        }
      );
    } catch (e) {
      tried.push(`${model}: falha de rede (${String(e && e.message || e).slice(0, 80)})`);
      continue;
    }

    if (res.ok && res.body) {
      return new Response(res.body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
      });
    }

    let msg = "";
    try { msg = (await res.json())?.error?.message || ""; } catch {}
    tried.push(`${model}: ${res.status} ${msg.slice(0, 140)}`);
    status = res.status;
    if (![429, 500, 503, 404].includes(res.status)) break;
  }

  return json({ error: tried.join(" | "), code: status }, status === 429 ? 429 : 502);
};
