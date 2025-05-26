// Módulo para gerenciamento do histórico de mensagens enviadas (Otimizado)

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('./utils');
const historicoManager = require('./historicoManager');

// Configurações do histórico
const MAX_HISTORICO_DIAS = parseInt(process.env.MAX_HISTORICO_DIAS || '90', 10);
const REGISTRAR_MENSAGENS_DETALHADAS = process.env.REGISTRAR_MENSAGENS_DETALHADAS === 'true';

// Cache de controle para evitar registros duplicados
const enviosRegistrados = new Set();

// Limpar mensagens antigas do histórico
function limparHistoricoAntigo(historico) {
  try {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - MAX_HISTORICO_DIAS);
    
    const mensagensAntes = historico.mensagens.length;
    
    // Manter apenas mensagens mais recentes que o limite (7 dias)
    historico.mensagens = historico.mensagens.filter(msg => {
      const dataMensagem = new Date(msg.timestamp || msg.data);
      return dataMensagem >= dataLimite;
    });
    
    const mensagensRemovidas = mensagensAntes - historico.mensagens.length;
    
    if (mensagensRemovidas > 0) {
      logger.debug(`Removidas ${mensagensRemovidas} mensagens antigas do histórico (mais de ${MAX_HISTORICO_DIAS} dias)`);
    }
    
    return historico;
  } catch (erro) {
    logger.error(`Erro ao limpar histórico antigo: ${erro.message}`);
    return historico;
  }
}

// Extrair versículos de uma mensagem devocional com uma única regex mais robusta
function extrairVersiculo(devocional) {
  try {
    if (!devocional) {
      logger.warn('Tentativa de extrair versículo de um devocional vazio ou nulo');
      return null;
    }
    
    // Usar uma única regex mais robusta que funciona para a maioria dos formatos
    // Captura qualquer texto entre aspas seguido por texto entre parênteses
    const regex = /[""]([^""]+)[""].*?\(([^)]+)\)/;
    const match = devocional.match(regex);
    
    if (match && match.length >= 3) {
      const texto = match[1].trim();
      const referencia = match[2].trim();
      
      logger.debug(`Versículo extraído: "${texto.substring(0, 20)}..." (${referencia})`);
      return {
        texto: texto,
        referencia: referencia
      };
    }
    
    // Se falhar, tente uma regex alternativa para referências bíblicas
    const refRegex = /\(([A-Za-záàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ]+ \d+:\d+(?:-\d+)?)\)/i;
    const refMatch = devocional.match(refRegex);
    
    if (refMatch && refMatch.length >= 2) {
      const referencia = refMatch[1].trim();
      logger.debug(`Apenas referência bíblica extraída: ${referencia}`);
      return {
        texto: "Texto do versículo não encontrado",
        referencia: referencia
      };
    }
    
    logger.warn(`Não foi possível extrair versículo do devocional`);
    return null;
  } catch (erro) {
    logger.error(`Erro ao extrair versículo: ${erro.message}`);
    return null;
  }
}

// Gerar uma chave única para o registro no cache
function gerarChaveRegistro(dados) {
  const versiculo = dados.versiculo ? dados.versiculo.referencia : 'sem-ref';
  return `${dados.data}_${versiculo}`;
}

// Registrar um envio no histórico
function registrarEnvio(dados) {
  try {
    // Verificar se já foi registrado para evitar duplicidades
    const chaveRegistro = gerarChaveRegistro(dados);
    if (enviosRegistrados.has(chaveRegistro)) {
      logger.debug(`Envio já registrado (${chaveRegistro}), ignorando`);
      return true;
    }
    
    // Usar o historicoManager para carregar o histórico
    const historico = historicoManager.carregarHistorico();
    
    // Extrair informações do versículo do devocional se não fornecido
    let versiculo = dados.versiculo;
    if (!versiculo && dados.devocional) {
      versiculo = extrairVersiculo(dados.devocional);
    }
    
    // Adicionar nova entrada ao histórico
    const novaEntrada = {
      data: dados.data,
      devocional: REGISTRAR_MENSAGENS_DETALHADAS ? dados.devocional : undefined,
      versiculo: versiculo,
      totalContatos: dados.totalContatos,
      enviosComSucesso: dados.enviosComSucesso,
      timestamp: new Date().toISOString()
    };
    
    // Adicionar ao histórico
    historico.mensagens.push(novaEntrada);
    
    // Registrar no cache para evitar duplicidades
    enviosRegistrados.add(chaveRegistro);
    
    // Limpar mensagens antigas antes de salvar
    limparHistoricoAntigo(historico);
    
    // Salvar o histórico atualizado
    const salvou = historicoManager.salvarHistorico(historico);
    
    return salvou;
  } catch (erro) {
    logger.error(`Erro ao registrar envio no histórico: ${erro.message}`);
    return false;
  }
}

// Obter versículos usados recentemente (para evitar repetições)
function obterVersiculosRecentes(dias = 7) {
  try {
    // Usar o historicoManager para carregar o histórico
    const historico = historicoManager.carregarHistorico();
    
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - dias);
    
    logger.debug(`Verificando versículos usados nos últimos ${dias} dias`);
    
    const versiculosRecentes = [];
    const refAdicionadas = new Set();
    
    for (const msg of historico.mensagens) {
      try {
        if (!msg.timestamp || !msg.versiculo || !msg.versiculo.referencia) continue;
        
        // Usar o timestamp para determinar se é recente
        const dataMensagem = new Date(msg.timestamp);
        const isRecente = dataMensagem >= dataLimite;
        
        // Adicionar apenas versículos únicos
        if (isRecente && !refAdicionadas.has(msg.versiculo.referencia)) {
          refAdicionadas.add(msg.versiculo.referencia);
          versiculosRecentes.push(msg.versiculo);
        }
      } catch (erroProcessamento) {
        // Ignorar entradas com erro
      }
    }
    
    if (versiculosRecentes.length > 0) {
      logger.debug(`Encontrados ${versiculosRecentes.length} versículos recentes a serem evitados`);
    }
    
    return versiculosRecentes;
  } catch (erro) {
    logger.error(`Erro ao obter versículos recentes: ${erro.message}`);
    return [];
  }
}

// Verificar se um versículo foi usado recentemente
function versiculoFoiUsadoRecentemente(referencia, dias = 30) {
  try {
    if (!referencia) {
      return false;
    }
    
    const versiculosRecentes = obterVersiculosRecentes(dias);
    
    // Normalizar a referência para comparação (remover espaços e converter para minúsculas)
    const referenciaFormatada = referencia.replace(/\s+/g, '').toLowerCase();
    
    // Verificar se a referência está na lista de versículos recentes
    const encontrado = versiculosRecentes.some(versiculo => {
      if (!versiculo || !versiculo.referencia) return false;
      
      const versiculoFormatado = versiculo.referencia.replace(/\s+/g, '').toLowerCase();
      return versiculoFormatado === referenciaFormatada;
    });
    
    if (encontrado) {
      logger.debug(`Versículo ${referencia} foi usado recentemente`);
    }
    
    return encontrado;
  } catch (erro) {
    logger.error(`Erro ao verificar versículo: ${erro.message}`);
    return false;
  }
}

// Obter o último devocional enviado
async function obterUltimoDevocionalEnviado() {
  try {
    // Tentar obter do histórico geral primeiro
    const historico = historicoManager.carregarHistorico();
    
    if (historico && historico.mensagens && historico.mensagens.length > 0) {
      // Ordenar mensagens por data (mais recente primeiro)
      const mensagensOrdenadas = [...historico.mensagens].sort((a, b) => {
        const dataA = a.timestamp ? new Date(a.timestamp) : new Date(0);
        const dataB = b.timestamp ? new Date(b.timestamp) : new Date(0);
        return dataB - dataA;
      });
      
      // Verificar se o último devocional foi enviado hoje
      const hoje = new Date();
      const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
      
      // Encontrar o último devocional
      for (const msg of mensagensOrdenadas) {
        if (msg.devocional) {
          // Extrair a data do timestamp
          const dataMensagem = new Date(msg.timestamp || msg.data);
          const dataMensagemStr = `${dataMensagem.getFullYear()}-${String(dataMensagem.getMonth() + 1).padStart(2, '0')}-${String(dataMensagem.getDate()).padStart(2, '0')}`;
          
          // Se o devocional for de hoje, retorná-lo
          if (dataMensagemStr === dataHoje) {
            logger.debug(`Devocional de hoje encontrado no histórico geral`);
            return msg.devocional;
          }
        }
      }
      
      // Se não encontrar um devocional de hoje, retorna o mais recente
      const ultimoDevocional = mensagensOrdenadas.find(msg => msg.devocional);
      if (ultimoDevocional && ultimoDevocional.devocional) {
        logger.debug('Retornando devocional mais recente disponível do histórico geral');
        return ultimoDevocional.devocional;
      }
    }
    
    // Se não encontrou no histórico geral, buscar nas conversas individuais
    logger.debug('Buscando devocional nas conversas individuais...');
    
    const CONVERSAS_DIR = process.env.CONVERSAS_DIR || './Conversas';
    if (!fs.existsSync(CONVERSAS_DIR)) {
      return null;
    }
    
    // Ler arquivos de conversa
    const arquivos = fs.readdirSync(CONVERSAS_DIR);
    const arquivosJson = arquivos.filter(arquivo => arquivo.endsWith('.json'));
    
    let devocionalMaisRecente = null;
    let dataMaisRecente = new Date(0); // Data antiga
    
    // Buscar em todas as conversas
    for (const arquivo of arquivosJson) {
      try {
        const conteudo = fs.readFileSync(path.join(CONVERSAS_DIR, arquivo), 'utf8');
        const conversa = JSON.parse(conteudo);
        
        if (conversa.ultimoDevocional) {
          const dataDevocional = new Date(conversa.ultimoDevocional.data);
          
          // Verificar se é mais recente que o último encontrado
          if (dataDevocional > dataMaisRecente) {
            devocionalMaisRecente = conversa.ultimoDevocional.conteudo;
            dataMaisRecente = dataDevocional;
          }
        }
      } catch (erroLeitura) {
        // Ignorar arquivos com erro
      }
    }
    
    if (devocionalMaisRecente) {
      logger.debug(`Devocional encontrado nas conversas individuais`);
      return devocionalMaisRecente;
    }
    
    return null;
  } catch (erro) {
    logger.error(`Erro ao obter último devocional: ${erro.message}`);
    return null;
  }
}

// Limpar o cache de registros
function limparCacheRegistros() {
  enviosRegistrados.clear();
  logger.debug('Cache de registros de envio limpo');
}

module.exports = {
  registrarEnvio,
  obterVersiculosRecentes,
  versiculoFoiUsadoRecentemente,
  obterUltimoDevocionalEnviado,
  extrairVersiculo,
  limparCacheRegistros
};