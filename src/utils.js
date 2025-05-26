// Módulo de funções utilitárias (Otimizado)

const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
moment.locale('pt-br');

// Configurações dos diretórios
const BASE_CONHECIMENTO_DIR = process.env.BASE_CONHECIMENTO_DIR || './Base_de_conhecimento';
const CONTATOS_DIR = process.env.CONTATOS_DIR || './Contatos';
const HISTORICO_DIR = process.env.HISTORICO_DIR || './Histórico';
const CONVERSAS_DIR = process.env.CONVERSAS_DIR || './Conversas';

// Logger aprimorado com níveis de verbosidade
const logger = {
  // Configuração de nível de log (1=ERROR, 2=WARN, 3=INFO, 4=DEBUG, 5=TRACE)
  level: parseInt(process.env.LOG_LEVEL || '3', 10),
  
  error: (mensagem) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${mensagem}`);
  },
  
  warn: (mensagem) => {
    if (logger.level >= 2)
      console.warn(`[WARN] ${new Date().toISOString()} - ${mensagem}`);
  },
  
  info: (mensagem) => {
    if (logger.level >= 3)
      console.log(`[INFO] ${new Date().toISOString()} - ${mensagem}`);
  },
  
  debug: (mensagem) => {
    if (logger.level >= 4)
      console.log(`[DEBUG] ${new Date().toISOString()} - ${mensagem}`);
  },
  
  trace: (mensagem) => {
    if (logger.level >= 5)
      console.log(`[TRACE] ${new Date().toISOString()} - ${mensagem}`);
  }
};

// Criar diretórios necessários
function criarDiretorios() {
  try {
    const diretorios = [BASE_CONHECIMENTO_DIR, CONTATOS_DIR, HISTORICO_DIR, CONVERSAS_DIR];
    
    diretorios.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Diretório criado: ${dir}`);
      }
    });
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao criar diretórios: ${erro.message}`);
    return false;
  }
}

// Formatar data no estilo brasileiro (dia de mês de ano)
function formatarData(data) {
  return moment(data).format('D [de] MMMM [de] YYYY');
}

// Remover acentos de uma string
function removerAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Limpar string (remover caracteres especiais, espaços extras, etc.)
function limparString(texto) {
  if (!texto) return '';
  
  return texto
    .replace(/\s+/g, ' ')              // Substitui múltiplos espaços por um único
    .replace(/[^\w\s\-\.,;:!?'"()]/g, '') // Remove caracteres especiais (exceto pontuação básica)
    .trim();                           // Remove espaços no início e fim
}

// Gerar um ID único
function gerarIdUnico() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Função para esperar um tempo determinado (útil para retry)
function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry de uma função assíncrona
async function retryAsync(funcao, tentativas = 3, intervalo = 1000) {
  let ultimoErro;
  
  for (let i = 0; i < tentativas; i++) {
    try {
      return await funcao();
    } catch (erro) {
      ultimoErro = erro;
      logger.warn(`Tentativa ${i + 1}/${tentativas} falhou: ${erro.message}`);
      
      if (i < tentativas - 1) {
        await esperar(intervalo);
      }
    }
  }
  
  throw ultimoErro;
}

module.exports = {
  logger,
  criarDiretorios,
  formatarData,
  removerAcentos,
  limparString,
  gerarIdUnico,
  esperar,
  retryAsync,
  dirs: {
    BASE_CONHECIMENTO_DIR,
    CONTATOS_DIR,
    HISTORICO_DIR,
    CONVERSAS_DIR
  }
};