// Módulo para gerenciar conversas individuais com os usuários (Otimizado)

const fs = require('fs-extra');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const leitorDocumentos = require('./leitorDocumentos');
const { logger, removerAcentos, dirs } = require('./utils');

// Configurações
const CONVERSAS_DIR = process.env.CONVERSAS_DIR || dirs.CONVERSAS_DIR || './Conversas';
const MAX_HISTORICO_CONVERSAS = parseInt(process.env.MAX_HISTORICO_CONVERSAS || '100', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODELOS_GEMINI = [
  "gemini-2.0-flash",
  "gemini-pro"
];
const RESPOSTA_MINIMA_LENGTH = parseInt(process.env.RESPOSTA_MINIMA_LENGTH || '10', 10);

// Inicializar cliente Gemini
let genAI;
let geminiModel;
let modeloAtual = '';

// Função para inicializar a API do Gemini
function inicializarGeminiAPI() {
  try {
    if (!GEMINI_API_KEY) {
      logger.error('Chave da API do Gemini não configurada no arquivo .env');
      return false;
    }
    
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // Tentar cada modelo na ordem de preferência
    for (const modelo of MODELOS_GEMINI) {
      try {
        geminiModel = genAI.getGenerativeModel({ model: modelo });
        modeloAtual = modelo;
        logger.info(`API do Google Gemini (${modelo}) inicializada com sucesso para conversas`);
        return true;
      } catch (erro) {
        logger.warn(`Erro ao inicializar modelo ${modelo} para conversas: ${erro.message}`);
        // Continua tentando o próximo modelo
      }
    }
    
    logger.error('Todos os modelos Gemini falharam na inicialização para conversas');
    return false;
  } catch (erro) {
    logger.error(`Erro ao inicializar API do Gemini para conversas: ${erro.message}`);
    return false;
  }
}

// Inicializar a API
inicializarGeminiAPI();

// Garantir que o diretório de conversas exista
function garantirDiretorioConversas() {
  if (!fs.existsSync(CONVERSAS_DIR)) {
    fs.mkdirSync(CONVERSAS_DIR, { recursive: true });
    logger.info(`Diretório de conversas criado: ${CONVERSAS_DIR}`);
  }
}

// Obter o caminho do arquivo de histórico para um telefone específico
function obterCaminhoHistoricoConversa(telefone) {
  garantirDiretorioConversas();
  const nomeArquivo = `${telefone}.json`;
  return path.join(CONVERSAS_DIR, nomeArquivo);
}

// Carregar histórico de conversa de um usuário
function carregarHistoricoConversa(telefone) {
  try {
    const caminhoArquivo = obterCaminhoHistoricoConversa(telefone);
    
    if (fs.existsSync(caminhoArquivo)) {
      const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
      return JSON.parse(conteudo);
    }
    
    // Retornar histórico vazio se não existir
    return {
      telefone: telefone,
      ultimaAtualizacao: new Date().toISOString(),
      ultimoDevocional: null,
      conversas: []
    };
  } catch (erro) {
    logger.error(`Erro ao carregar histórico de conversa para ${telefone}: ${erro.message}`);
    return {
      telefone: telefone,
      ultimaAtualizacao: new Date().toISOString(),
      ultimoDevocional: null,
      conversas: []
    };
  }
}

// Salvar histórico de conversa de um usuário
function salvarHistoricoConversa(historico) {
  try {
    garantirDiretorioConversas();
    
    // Atualizar a data da última atualização
    historico.ultimaAtualizacao = new Date().toISOString();
    
    // Manter no máximo MAX_HISTORICO_CONVERSAS mensagens
    if (historico.conversas.length > MAX_HISTORICO_CONVERSAS) {
      // Adicionar log para saber quantas mensagens foram removidas
      const antes = historico.conversas.length;
      historico.conversas = historico.conversas.slice(-MAX_HISTORICO_CONVERSAS);
      logger.debug(`Limitando histórico de conversas: removidas ${antes - historico.conversas.length} mensagens antigas`);
    }
    
    // Manter apenas mensagens dos últimos 7 dias
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
    
    // Filtrar conservando apenas mensagens dos últimos 7 dias
    const mensagensAntesDoFiltro = historico.conversas.length;
    historico.conversas = historico.conversas.filter(mensagem => {
      const dataMensagem = new Date(mensagem.timestamp);
      return dataMensagem >= seteDiasAtras;
    });
    
    if (mensagensAntesDoFiltro > historico.conversas.length) {
      logger.debug(`Removidas ${mensagensAntesDoFiltro - historico.conversas.length} mensagens com mais de 7 dias do histórico de ${historico.telefone}`);
    }
    
    const caminhoArquivo = obterCaminhoHistoricoConversa(historico.telefone);
    fs.writeFileSync(caminhoArquivo, JSON.stringify(historico, null, 2));
    
    logger.debug(`Histórico de conversa salvo para ${historico.telefone} (${historico.conversas.length} mensagens)`);
    return true;
  } catch (erro) {
    logger.error(`Erro ao salvar histórico de conversa para ${historico.telefone}: ${erro.message}`);
    return false;
  }
}

// Registrar um devocional enviado para um usuário
function registrarDevocionalEnviado(telefone, devocional) {
  try {
    // Carregar histórico existente para preservar conversas
    const historico = carregarHistoricoConversa(telefone);
    
    // Manter as conversas anteriores e apenas atualizar o devocional
    historico.ultimoDevocional = {
      data: new Date().toISOString(),
      conteudo: devocional
    };
    
    // Adicionar uma entrada de sistema no histórico para marcar o envio do devocional
    // Isso ajuda a contextualizar as conversas anteriores e posteriores
    historico.conversas.push({
      timestamp: new Date().toISOString(),
      remetente: 'sistema',
      mensagem: 'Novo devocional enviado'
    });
    
    return salvarHistoricoConversa(historico);
  } catch (erro) {
    logger.error(`Erro ao registrar devocional para ${telefone}: ${erro.message}`);
    return false;
  }
}

// Registrar uma mensagem na conversa
function registrarMensagem(telefone, remetente, mensagem, tokens = 0, custoTokens = 0) {
  try {
    const historico = carregarHistoricoConversa(telefone);

    const tokensNum = Number(tokens) || 0;
    const custoTokensNum = Number(custoTokens) || 0;
    
    // Adicionar a mensagem ao histórico
    historico.conversas.push({
      timestamp: new Date().toISOString(),
      remetente: remetente, // 'usuario' ou 'bot'
      mensagem: mensagem,
      tokens: tokensNum,
      preco_token_R$: Number(custoTokensNum.toFixed(4))
    });
    
    return salvarHistoricoConversa(historico);
  } catch (erro) {
    logger.error(`Erro ao registrar mensagem para ${telefone}: ${erro.message}`);
    return false;
  }
}

// Verificar se uma mensagem parece ser uma pergunta
function ePergunta(mensagem) {
  // Remover acentos e converter para minúsculas
  const textoNormalizado = removerAcentos(mensagem.toLowerCase());
  
  // Verificar se termina com ponto de interrogação
  if (textoNormalizado.includes('?')) {
    return true;
  }
  
  // Verificar palavras-chave de perguntas
  const palavrasChavePergunta = [
    'quem', 'como', 'por que', 'porque', 'quando', 'onde', 'qual', 'quais',
    'o que', 'oq', 'pq', 'me explica', 'pode explicar', 'explique', 'significa',
    'entendi', 'não entendi', 'nao entendi', 'duvida', 'dúvida'
  ];
  
  return palavrasChavePergunta.some(palavra => textoNormalizado.includes(palavra));
}

// Verificar se é a primeira interação de um usuário
async function isPrimeiraInteracao(telefone) {
  try {
    const caminhoArquivo = obterCaminhoHistoricoConversa(telefone);
    
    // Verificar se o arquivo de histórico existe
    const existeHistorico = fs.existsSync(caminhoArquivo);
    
    // Se o arquivo não existir, é a primeira interação
    if (!existeHistorico) {
      return true;
    }
    
    // Se o arquivo existir, verificar se tem conteúdo válido
    try {
      const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
      const historico = JSON.parse(conteudo);
      
      // Verificar se o histórico tem conversas
      if (!historico.conversas || historico.conversas.length === 0) {
        return true;
      }
      
      // Se chegou aqui, não é a primeira interação
      return false;
    } catch (erroLeitura) {
      logger.error(`Erro ao ler histórico para ${telefone}: ${erroLeitura.message}`);
      // Em caso de erro de leitura, considerar como primeira interação para garantir
      return true;
    }
  } catch (erro) {
    logger.error(`Erro ao verificar primeira interação para ${telefone}: ${erro.message}`);
    return false;
  }
}

// Preparar o prompt para a resposta da IA
async function prepararPromptResposta(telefone, mensagemUsuario) {
  const historico = carregarHistoricoConversa(telefone);
  const ultimoDevocional = historico.ultimoDevocional ? historico.ultimoDevocional.conteudo : '';
  
  // Obter últimas conversas para contexto (limitado às 5 últimas)
  const conversasRecentes = historico.conversas.slice(-5);
  const conversasFormatadas = conversasRecentes.map(c => 
    `${c.remetente === 'usuario' ? 'Pessoa' : 'Bot'}: ${c.mensagem}`
  ).join('\n');
  
  // Obter conteúdo da base de conhecimento
  const baseConhecimento = await leitorDocumentos.obterConteudoBase();
  
  const prompt = `
  Você é um assistente espiritual que está respondendo perguntas sobre um devocional diário que você enviou para uma pessoa via WhatsApp.
  
  Seu último devocional enviado foi:
  ${ultimoDevocional}
  
  O contexto da conversa recente é:
  ${conversasFormatadas}
  
  A pessoa acabou de enviar esta mensagem para você:
  "${mensagemUsuario}"
  
  Baseie-se no devocional enviado e na seguinte base de conhecimento religiosa para responder:
  ${baseConhecimento.substring(0, 10000)}
  
  Responda à pergunta ou comentário da pessoa de forma amigável, acolhedora e espiritual. 
  Mantenha a resposta concisa (até 5 frases), mas esclarecedora e relevante para a mensagem da pessoa.
  Se for uma pergunta sobre o devocional, dê uma resposta específica baseada no versículo e na reflexão.
  Se não for uma pergunta relacionada ao devocional, responda de forma generalista e gentil, evitando debates teológicos complexos.
  
  Não mencione que você é uma IA ou um bot. Responda como um aconselhador espiritual amigável.
  `;
  
  return prompt.trim();
}

// Gerar resposta para uma mensagem do usuário
async function gerarRespostaParaMensagem(telefone, mensagemUsuario) {
  try {
    // Verificar se a API Gemini está inicializada
    if (!geminiModel) {
      const inicializou = inicializarGeminiAPI();
      if (!inicializou) {
        return "Não foi possível responder no momento. Por favor, tente novamente mais tarde.";
      }
    }
    
    // Registrar a mensagem do usuário
    registrarMensagem(telefone, 'usuario', mensagemUsuario);
    
    // Verificar se a mensagem é uma pergunta ou comentário que precisa de resposta elaborada
    if (!ePergunta(mensagemUsuario) && mensagemUsuario.length < RESPOSTA_MINIMA_LENGTH) {
      const respostasSimples = [
        "Amém! Tenha um dia abençoado.",
        "Que Deus te abençoe hoje e sempre.",
        "Obrigado por compartilhar. Fique na paz de Cristo.",
        "Louvado seja Deus! Tenha um excelente dia.",
        "Que a graça de Deus esteja com você hoje."
      ];
      
      const resposta = respostasSimples[Math.floor(Math.random() * respostasSimples.length)];
      registrarMensagem(telefone, 'bot', resposta, 0, 0);
      return resposta;
    }
    
    // Preparar o prompt
    const prompt = await prepararPromptResposta(telefone, mensagemUsuario);
    const tokensEntrada = Math.ceil(prompt.length / 4);
    
    // Gerar resposta com a IA
    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });
    
    const resposta = result.response.text().trim();
    
    let tokensSaida = 0;
    let tokensTotal = 0;
    let custoEstimado = 0;

    try {
      if (result.response && result.response.candidates && result.response.candidates[0].tokensCount) {
        tokensSaida = result.resposta.candidates[0].tokenCount;
      } else if (result.response && result.response.usage && result.response.usage.outputTokens) {
        tokensSaida = result.response.tokenCount;
      } else if (result.usage && result.usage.totalTokens) {
        tokensTotal = result.usage.totalTokens;
        tokensSaida = tokensTotal - tokensEntrada;
      } else {
        tokensSaida = Math.ceil(resposta.length / 4);
      }
    } catch (errorTokens) {
      tokensSaida = Math.ceil(resposta.length / 4);
    }

    if (tokensTotal === 0) {
      tokensTotal = tokensEntrada - tokensSaida;
    }

    const precoEntradaPorMil = 0.00125;
    const precoSaidaPorMil = 0.00375;

    const custoEntrada = (tokensEntrada / 1000) * precoEntradaPorMil;
    const custoSaida = (tokensSaida / 1000) * precoSaidaPorMil;
    custoEstimado = custoEntrada + custoSaida;

    // Registrar a resposta do bot
    registrarMensagem(telefone, 'bot', resposta, tokensTotal, custoEstimado);
    
    return resposta;
  } catch (erro) {
    logger.error(`Erro ao gerar resposta para ${telefone}: ${erro.message}`);
    
    // Resposta de fallback em caso de erro
    const respostaFallback = "Agradeço sua mensagem. Estou refletindo sobre isso e logo poderei responder com mais clareza. Que Deus abençoe seu dia.";
    registrarMensagem(telefone, 'bot', respostaFallback, 0, 0);
    
    return respostaFallback;
  }
}

module.exports = {
  registrarDevocionalEnviado,
  gerarRespostaParaMensagem,
  ePergunta,
  isPrimeiraInteracao
};