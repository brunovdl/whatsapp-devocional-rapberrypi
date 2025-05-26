// Módulo para processamento dos documentos base (Otimizado)

const fs = require('fs-extra');
const path = require('path');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const { logger } = require('./utils');

// Diretório de documentos base
const BASE_DIR = process.env.BASE_CONHECIMENTO_DIR || './Base_de_conhecimento';

// Cache de documentos processados
const cacheInfo = {
  conteudo: null,
  ultimaAtualizacao: null,
  arquivosProcessados: new Map(), // Map de arquivo -> timestamp da última modificação
  valido: false
};

// Verificar a necessidade de atualização do cache
function verificarCacheAtualizado() {
  if (!cacheInfo.conteudo || !cacheInfo.valido) {
    return false;
  }
  
  try {
    const arquivos = obterArquivosBase();
    
    // Verificar se a lista de arquivos mudou
    const arquivosAtuais = new Set(arquivos);
    const arquivosCached = new Set(cacheInfo.arquivosProcessados.keys());
    
    if (arquivosAtuais.size !== arquivosCached.size) {
      return false;
    }
    
    // Verificar se algum arquivo foi modificado
    for (const arquivo of arquivos) {
      const caminhoArquivo = path.join(BASE_DIR, arquivo);
      const stats = fs.statSync(caminhoArquivo);
      
      // Verificar se o arquivo está no cache e se foi modificado
      const ultimaModificacaoCache = cacheInfo.arquivosProcessados.get(arquivo);
      if (!ultimaModificacaoCache || stats.mtime > ultimaModificacaoCache) {
        return false;
      }
    }
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao verificar cache: ${erro.message}`);
    return false;
  }
}

// Obter a lista de arquivos da base de conhecimento
function obterArquivosBase() {
  try {
    if (!fs.existsSync(BASE_DIR)) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
      logger.info(`Diretório de base de conhecimento criado: ${BASE_DIR}`);
      return [];
    }
    
    const arquivos = fs.readdirSync(BASE_DIR);
    return arquivos.filter(arquivo => {
      const extensao = path.extname(arquivo).toLowerCase();
      return ['.pdf', '.json', '.txt', '.csv', '.xlsx'].includes(extensao);
    });
  } catch (erro) {
    logger.error(`Erro ao ler diretório da base de conhecimento: ${erro.message}`);
    return [];
  }
}

// Processar um arquivo PDF
async function processarPdf(caminhoArquivo) {
  try {
    const dataBuffer = fs.readFileSync(caminhoArquivo);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (erro) {
    logger.error(`Erro ao processar PDF ${path.basename(caminhoArquivo)}: ${erro.message}`);
    return '';
  }
}

// Processar um arquivo JSON
function processarJson(caminhoArquivo) {
  try {
    const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
    const data = JSON.parse(conteudo);
    
    // Extrair textos do JSON
    return extrairTextosJson(data);
  } catch (erro) {
    logger.error(`Erro ao processar JSON ${path.basename(caminhoArquivo)}: ${erro.message}`);
    return '';
  }
}

// Extrair textos recursivamente de um objeto JSON
function extrairTextosJson(obj, textos = []) {
  if (!obj) return textos;
  
  if (typeof obj === 'string') {
    textos.push(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach(item => extrairTextosJson(item, textos));
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(valor => extrairTextosJson(valor, textos));
  }
  
  return textos.join('\n');
}

// Processar um arquivo TXT
function processarTxt(caminhoArquivo) {
  try {
    return fs.readFileSync(caminhoArquivo, 'utf8');
  } catch (erro) {
    logger.error(`Erro ao processar TXT ${path.basename(caminhoArquivo)}: ${erro.message}`);
    return '';
  }
}

// Processar um arquivo CSV
async function processarCsv(caminhoArquivo) {
  return new Promise((resolve, reject) => {
    const linhas = [];
    
    fs.createReadStream(caminhoArquivo)
      .pipe(csvParser())
      .on('data', (row) => {
        linhas.push(Object.values(row).join(' '));
      })
      .on('end', () => {
        resolve(linhas.join('\n'));
      })
      .on('error', (erro) => {
        logger.error(`Erro ao processar CSV ${path.basename(caminhoArquivo)}: ${erro.message}`);
        reject(erro);
      });
  });
}

// Processar um arquivo Excel
function processarExcel(caminhoArquivo) {
  try {
    const workbook = xlsx.readFile(caminhoArquivo);
    const resultado = [];
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const dados = xlsx.utils.sheet_to_json(worksheet);
      
      dados.forEach(linha => {
        resultado.push(Object.values(linha).join(' '));
      });
    });
    
    return resultado.join('\n');
  } catch (erro) {
    logger.error(`Erro ao processar Excel ${path.basename(caminhoArquivo)}: ${erro.message}`);
    return '';
  }
}

// Processar HTML (para arquivos que possam conter HTML)
function processarHtml(conteudo) {
  try {
    const $ = cheerio.load(conteudo);
    // Remover scripts e estilos
    $('script').remove();
    $('style').remove();
    
    // Obter o texto
    return $('body').text().trim();
  } catch (erro) {
    logger.error(`Erro ao processar HTML: ${erro.message}`);
    return conteudo;
  }
}

// Processar um arquivo baseado na sua extensão
async function processarArquivo(arquivo) {
  const caminhoArquivo = path.join(BASE_DIR, arquivo);
  const extensao = path.extname(arquivo).toLowerCase();
  let conteudo = '';
  
  try {
    logger.debug(`Processando arquivo: ${arquivo}`);
    
    switch (extensao) {
      case '.pdf':
        conteudo = await processarPdf(caminhoArquivo);
        break;
      case '.json':
        conteudo = processarJson(caminhoArquivo);
        break;
      case '.txt':
        conteudo = processarTxt(caminhoArquivo);
        break;
      case '.csv':
        conteudo = await processarCsv(caminhoArquivo);
        break;
      case '.xlsx':
        conteudo = processarExcel(caminhoArquivo);
        break;
      default:
        logger.warn(`Tipo de arquivo não suportado: ${extensao}`);
        return '';
    }
    
    // Verificar se o conteúdo pode conter HTML e processá-lo se necessário
    if (conteudo.includes('<html') || conteudo.includes('<body') || conteudo.includes('<div')) {
      conteudo = processarHtml(conteudo);
    }
    
    // Atualizar o cache
    const stats = fs.statSync(caminhoArquivo);
    cacheInfo.arquivosProcessados.set(arquivo, stats.mtime);
    
    return conteudo;
  } catch (erro) {
    logger.error(`Erro ao processar arquivo ${arquivo}: ${erro.message}`);
    return '';
  }
}

// Obter todo o conteúdo da base de conhecimento
async function obterConteudoBase() {
  // Verificar se o cache está atualizado
  if (verificarCacheAtualizado()) {
    logger.debug('Usando cache da base de conhecimento');
    return cacheInfo.conteudo;
  }
  
  try {
    const arquivos = obterArquivosBase();
    
    if (arquivos.length === 0) {
      logger.warn('Nenhum arquivo encontrado na base de conhecimento');
      
      // Atualizar o cache mesmo vazio
      cacheInfo.conteudo = '';
      cacheInfo.ultimaAtualizacao = new Date();
      cacheInfo.valido = true;
      cacheInfo.arquivosProcessados.clear();
      
      return '';
    }
    
    logger.info(`Processando ${arquivos.length} arquivos da base de conhecimento`);
    
    // Processar todos os arquivos em paralelo para melhor desempenho
    const conteudos = await Promise.all(
      arquivos.map(arquivo => processarArquivo(arquivo))
    );
    
    // Combinar todos os conteúdos
    const conteudoCompleto = conteudos.join('\n\n');
    
    // Atualizar o cache
    cacheInfo.conteudo = conteudoCompleto;
    cacheInfo.ultimaAtualizacao = new Date();
    cacheInfo.valido = true;
    
    logger.info('Base de conhecimento processada com sucesso');
    return conteudoCompleto;
  } catch (erro) {
    logger.error(`Erro ao obter conteúdo da base: ${erro.message}`);
    return '';
  }
}

// Limpar o cache forçadamente
function limparCache() {
  cacheInfo.conteudo = null;
  cacheInfo.ultimaAtualizacao = null;
  cacheInfo.valido = false;
  cacheInfo.arquivosProcessados.clear();
  logger.debug('Cache da base de conhecimento limpo');
}

module.exports = {
  obterConteudoBase,
  limparCache
};