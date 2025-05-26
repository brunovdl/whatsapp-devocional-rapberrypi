// Módulo gerador de devocionais com IA (Google Gemini) - Otimizado

const { GoogleGenerativeAI } = require('@google/generative-ai');
const leitorDocumentos = require('./leitorDocumentos');
const historicoMensagens = require('./historicoMensagens');
const verificadorFormato = require('./verificadorFormato');
const { logger } = require('./utils');

// Configuração da API do Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEMPERATURA_BASE = parseFloat(process.env.TEMPERATURA_BASE || '0.7');
const MAX_TENTATIVAS = parseInt(process.env.MAX_TENTATIVAS || '3', 10);

// Inicializar o cliente Gemini
let genAI;
let geminiModel;
let modeloAtual = '';

// Modelos em ordem de preferência
const MODELOS_GEMINI = [
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-pro"
];

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
        logger.info(`API do Google Gemini (${modelo}) inicializada com sucesso`);
        return true;
      } catch (erro) {
        logger.warn(`Erro ao inicializar modelo ${modelo}: ${erro.message}`);
        // Continua tentando o próximo modelo
      }
    }
    
    logger.error('Todos os modelos Gemini falharam na inicialização');
    return false;
  } catch (erro) {
    logger.error(`Erro ao inicializar API do Gemini: ${erro.message}`);
    return false;
  }
}

// Tentar inicializar a API
inicializarGeminiAPI();

// Validar se o devocional gerado tem um versículo único
async function validarDevocionalGerado(devocional) {
  try {
    // Extrair o versículo do devocional
    const versiculo = historicoMensagens.extrairVersiculo(devocional);
    
    if (!versiculo || !versiculo.referencia) {
      logger.warn('Não foi possível extrair versículo do devocional gerado');
      return false;
    }
    
    // Verificar se o versículo já foi usado recentemente
    const jaUsado = historicoMensagens.versiculoFoiUsadoRecentemente(versiculo.referencia, 30);
    
    if (jaUsado) {
      logger.warn(`Versículo ${versiculo.referencia} já foi usado recentemente, rejeitando o devocional`);
      return false;
    }
    
    logger.debug(`Versículo ${versiculo.referencia} é único nos últimos 30 dias`);
    return true;
  } catch (erro) {
    logger.error(`Erro ao validar devocional: ${erro.message}`);
    return false;
  }
}

// Validar e corrigir o formato do devocional gerado
async function validarFormatoDevocional(devocional) {
  // Verificar se o devocional tem o formato esperado
  const { valido, mensagem } = verificadorFormato.verificarFormatoDevocional(devocional);
  
  if (!valido) {
    logger.warn(`Problema com formato do devocional: ${mensagem}`);
    
    // Tentar corrigir o formato
    const devocionalCorrigido = verificadorFormato.corrigirFormatoDevocional(devocional);
    
    // Verificar se a correção foi bem-sucedida
    const resultadoCorrecao = verificadorFormato.verificarFormatoDevocional(devocionalCorrigido);
    
    if (resultadoCorrecao.valido) {
      logger.debug("Formato do devocional corrigido com sucesso");
      return devocionalCorrigido;
    } else {
      logger.warn("Não foi possível corrigir completamente o formato do devocional");
      // Mesmo que não pudemos corrigir completamente, retornar a versão que tentamos corrigir
      return devocionalCorrigido;
    }
  }
  
  // Se já estava no formato correto, retornar sem alterações
  return devocional;
}

// Gerar um prompt para o Gemini
async function gerarPrompt(dataAtual) {
  try {
    // Obter conteúdo da base de conhecimento
    const baseConhecimento = await leitorDocumentos.obterConteudoBase();
    
    // Obter versículos recentes (para evitar repetições)
    const versiculosRecentes = historicoMensagens.obterVersiculosRecentes(30);
    const versiculosRecentesTexto = versiculosRecentes
      .map(v => {
        if (!v || !v.referencia || !v.texto) return '';
        return `${v.referencia}: "${v.texto}"`;
      })
      .filter(v => v) // Remove entradas vazias
      .join('\n');
    
    // Adicionar log para debug
    logger.debug(`${versiculosRecentes.length} versículos a serem evitados`);
    
    // Construir o prompt
    const prompt = `
      Você é um bot de WhatsApp com inteligência artificial projetado para enviar um devocional diário todas as manhãs.
      
      Seu objetivo é criar uma mensagem devocional que contenha:
      1. A data atual (${dataAtual})
      2. Um versículo bíblico relevante
      3. Um título para o devocional
      4. Um texto explicativo sobre o versículo (3-5 frases)
      5. Uma sugestão prática para o dia (1-2 frases)
      6. Uma pergunta ou convite ao diálogo ao final que incentive o usuário a responder
      
      O tom deve ser caloroso, pessoal e conversacional, como se você estivesse falando diretamente com o usuário.
      Use frases que incentivem a interação como "O que você acha disso?", "Como isso ressoa com você hoje?", 
      ou "Gostaria de compartilhar como este versículo fala à sua vida?".
      
      MUITO IMPORTANTE: Você deve gerar um devocional com um versículo diferente a cada dia. Nunca repita versículos que já foram usados recentemente.
      
      Baseie-se no seguinte conteúdo para selecionar o versículo e elaborar a reflexão:
      
      ${baseConhecimento.substring(0, 15000)} 
      
      Evite usar ABSOLUTAMENTE os seguintes versículos que foram utilizados recentemente:
      ${versiculosRecentesTexto || "Nenhum versículo recente a evitar."}
      
      Exemplo do formato esperado:
      
      "📅 ${dataAtual}

      *Tudo o que fizer faça com amor*
      
      📖 *Versículo:* \"Tudo o que fizerem, façam de todo o coração, como para o Senhor.\" (Colossenses 3:23)
      
      💭 *Reflexão:* Este versículo nos lembra que nossas ações diárias, por menores que sejam, ganham significado quando as dedicamos a Deus. Trabalhar, ajudar alguém ou até descansar pode ser uma forma de honrá-Lo se fizermos com amor e propósito. Que tal começar o dia com essa intenção no coração?
      
      🧗🏼 *Prática:* Hoje, escolha uma tarefa simples e a realize com dedicação, pensando em como ela pode refletir seu cuidado com os outros e com Deus.
      
      🤔 *E você?* Há alguma área da sua vida onde você gostaria de trazer mais propósito e dedicação? Ficarei feliz em conversar sobre isso."
      
      Gere o devocional seguindo exatamente esse formato.
    `;
    
    return prompt.trim();
  } catch (erro) {
    logger.error(`Erro ao gerar prompt: ${erro.message}`);
    throw erro;
  }
}

// Gerar o devocional utilizando o Gemini com validação de versículo único
async function gerarDevocional(dataAtual) {
  try {
    // Verificar se a API foi inicializada corretamente
    if (!geminiModel) {
      logger.warn('API do Gemini não inicializada. Tentando inicializar novamente...');
      
      // Tentar inicializar novamente
      const inicializou = inicializarGeminiAPI();
      
      if (!inicializou || !geminiModel) {
        throw new Error('Falha ao inicializar API do Gemini. Verifique a chave de API.');
      }
    }
    
    // Contador de tentativas para evitar loop infinito
    let tentativas = 0;
    let devocionalValido = false;
    let devocional = '';
    
    while (!devocionalValido && tentativas < MAX_TENTATIVAS) {
      tentativas++;
      logger.info(`Gerando devocional - tentativa ${tentativas}/${MAX_TENTATIVAS}`);
      
      // Gerar o prompt com os versículos a serem evitados
      const prompt = await gerarPrompt(dataAtual);
      
      try {
        const result = await geminiModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: TEMPERATURA_BASE + (tentativas * 0.1), // Aumentar a temperatura a cada tentativa
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        });
        
        const response = result.response;
        devocional = response.text().trim();

        // Validar e corrigir o formato do devocional
        devocional = await validarFormatoDevocional(devocional);
        
        // Verificar se o devocional foi gerado corretamente
        if (!devocional || devocional.length < 50) {
          logger.warn('Devocional gerado muito curto ou vazio. Tentando novamente.');
          continue;
        }
        
        // Validar se o versículo não foi usado recentemente
        devocionalValido = await validarDevocionalGerado(devocional);
        
        if (devocionalValido) {
          logger.info('Devocional válido gerado com sucesso');
          return devocional;
        } else {
          logger.warn('Devocional gerado usa versículo repetido ou inválido. Tentando novamente.');
        }
      } catch (erroGemini) {
        logger.warn(`Erro com o modelo na tentativa ${tentativas}: ${erroGemini.message}`);
        
        if (tentativas >= MAX_TENTATIVAS) {
          logger.error('Número máximo de tentativas atingido. Usando fallback.');
          return gerarDevocionalFallback(dataAtual);
        }
      }
    }
    
    // Se chegou aqui sem um devocional válido, usar fallback
    if (!devocionalValido) {
      logger.warn('Não foi possível gerar um devocional com versículo único. Usando fallback.');
      return gerarDevocionalFallback(dataAtual);
    }
    
    return devocional;
  } catch (erro) {
    logger.error(`Erro ao gerar devocional: ${erro.message}`);
    return gerarDevocionalFallback(dataAtual);
  }
}

// Gerar um devocional de fallback em caso de erro na API
function gerarDevocionalFallback(dataAtual) {
  logger.info('Gerando devocional de fallback...');
  
  // Lista de devocionais de fallback com versículos diferentes
  const devocionaisFallback = [
    {
      versiculo: "Não temas, porque eu sou contigo; não te assombres, porque eu sou teu Deus; eu te fortaleço, e te ajudo, e te sustento com a destra da minha justiça.",
      referencia: "Isaías 41:10",
      reflexao: "Mesmo quando enfrentamos dificuldades ou desafios inesperados, Deus está ao nosso lado, pronto para nos dar força e sustento. Este versículo nos lembra que não precisamos temer, pois temos a presença constante do Senhor em nossas vidas, guiando nossos passos e iluminando nosso caminho.",
      pratica: "Hoje, ao enfrentar qualquer situação desafiadora, faça uma pausa, respire e relembre esta promessa de sustento divino antes de prosseguir."
    },
    {
      versiculo: "Tudo posso naquele que me fortalece.",
      referencia: "Filipenses 4:13",
      reflexao: "Este versículo nos lembra que nossa força vem de Deus. Quando enfrentamos desafios que parecem além das nossas capacidades, não estamos sozinhos. Com o poder de Cristo, podemos superar obstáculos que sozinhos seriam impossíveis. Esta não é uma promessa de sucesso em tudo, mas de força para perseverar em todas as circunstâncias.",
      pratica: "Identifique um desafio atual em sua vida e entregue-o em oração, reconhecendo sua dependência da força divina para superá-lo."
    },
    {
      versiculo: "O Senhor é meu pastor; nada me faltará.",
      referencia: "Salmos 23:1",
      reflexao: "Neste belo salmo, Davi compara o cuidado de Deus ao de um pastor dedicado que supre todas as necessidades de suas ovelhas. Quando confiamos em Deus como nosso pastor, podemos descansar na certeza de que Ele conhece nossas necessidades e cuida de nós com amor e sabedoria, mesmo nos momentos mais difíceis.",
      pratica: "Reserve um momento hoje para listar suas necessidades e agradecer a Deus pelo cuidado que Ele já está providenciando em cada área."
    }
  ];
  
  // Escolher um devocional aleatório da lista
  const fallback = devocionaisFallback[Math.floor(Math.random() * devocionaisFallback.length)];
  
  // Formatar o devocional no padrão esperado
  return `📅 ${dataAtual}

📖 *Versículo:* "${fallback.versiculo}" (${fallback.referencia})

💭 *Reflexão:* ${fallback.reflexao}

🧗🏻 *Prática:* ${fallback.pratica}`;
}

module.exports = {
  gerarDevocional,
  validarDevocionalGerado,
  validarFormatoDevocional,
  inicializarGeminiAPI
};