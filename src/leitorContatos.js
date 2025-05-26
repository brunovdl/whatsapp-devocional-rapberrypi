// Módulo para leitura da lista de contatos de arquivos Excel ou CSV (Otimizado)

const fs = require('fs-extra');
const path = require('path');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');
const { logger } = require('./utils');

// Diretório de contatos
const CONTATOS_DIR = process.env.CONTATOS_DIR || './Contatos';

// Cache de contatos para evitar releitura frequente
let contatosCache = null;
let ultimaAtualizacaoContatos = null;

// Obter a lista de arquivos de contatos disponíveis
function obterArquivosContatos() {
  try {
    if (!fs.existsSync(CONTATOS_DIR)) {
      fs.mkdirSync(CONTATOS_DIR, { recursive: true });
      logger.info(`Diretório de contatos criado: ${CONTATOS_DIR}`);
      return [];
    }
    
    const arquivos = fs.readdirSync(CONTATOS_DIR);
    return arquivos.filter(arquivo => {
      const extensao = path.extname(arquivo).toLowerCase();
      return extensao === '.xlsx' || extensao === '.csv';
    });
  } catch (erro) {
    logger.error(`Erro ao ler diretório de contatos: ${erro.message}`);
    return [];
  }
}

// Verificar se é necessário atualizar o cache de contatos
function verificarCacheContatos() {
  if (!contatosCache || !ultimaAtualizacaoContatos) {
    return false;
  }
  
  try {
    const arquivos = obterArquivosContatos();
    
    // Verificar se algum arquivo foi modificado desde a última atualização
    for (const arquivo of arquivos) {
      const caminhoArquivo = path.join(CONTATOS_DIR, arquivo);
      const stats = fs.statSync(caminhoArquivo);
      
      if (stats.mtime > ultimaAtualizacaoContatos) {
        return false;
      }
    }
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao verificar cache de contatos: ${erro.message}`);
    return false;
  }
}

// Ler contatos de um arquivo Excel
async function lerContatosExcel(caminhoArquivo) {
  try {
    logger.debug(`Lendo arquivo Excel: ${path.basename(caminhoArquivo)}`);
    
    // Opções adicionais para melhorar a leitura
    const workbook = xlsx.readFile(caminhoArquivo, {
      cellDates: true,
      cellNF: true,
      cellText: true
    });
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      logger.error('Arquivo Excel sem planilhas');
      return [];
    }
    
    // Verificar todas as planilhas para encontrar contatos
    let todosContatos = [];
    
    for (const sheetName of workbook.SheetNames) {
      logger.debug(`Processando planilha: ${sheetName}`);
      
      const worksheet = workbook.Sheets[sheetName];
      
      // Verificar se a planilha tem dados
      if (!worksheet['!ref']) {
        logger.debug(`Planilha ${sheetName} vazia, pulando...`);
        continue;
      }
      
      // Tentar ler os dados da planilha
      try {
        const dados = xlsx.utils.sheet_to_json(worksheet, {
          defval: '',  // Valor padrão para células vazias
          raw: false   // Não converter tipos automaticamente
        });
        
        logger.debug(`Encontrados ${dados.length} registros na planilha ${sheetName}`);
        
        if (dados.length > 0) {
          const contatos = normalizarContatos(dados);
          todosContatos = todosContatos.concat(contatos);
        }
      } catch (erroLeitura) {
        logger.error(`Erro ao processar planilha ${sheetName}: ${erroLeitura.message}`);
      }
    }
    
    return todosContatos;
  } catch (erro) {
    logger.error(`Erro ao ler arquivo Excel: ${erro.message}`);
    return [];
  }
}

// Ler contatos de um arquivo CSV
async function lerContatosCsv(caminhoArquivo) {
  return new Promise((resolve, reject) => {
    const contatos = [];
    
    fs.createReadStream(caminhoArquivo)
      .pipe(csvParser())
      .on('data', (row) => {
        contatos.push(row);
      })
      .on('end', () => {
        resolve(normalizarContatos(contatos));
      })
      .on('error', (erro) => {
        logger.error(`Erro ao ler arquivo CSV: ${erro.message}`);
        reject(erro);
      });
  });
}

// Normalizar os dados dos contatos para um formato padrão
function normalizarContatos(dados) {
  if (!dados || !Array.isArray(dados) || dados.length === 0) {
    logger.warn('Nenhum dado de contato válido encontrado para normalizar');
    return [];
  }
  
  // Log dos campos disponíveis para debug
  if (dados.length > 0) {
    logger.debug(`Campos disponíveis: ${Object.keys(dados[0]).join(', ')}`);
  }
  
  // Processar todos os contatos
  const contatosProcessados = dados.map(contato => {
    // Tentar encontrar os campos de nome e telefone, independente da capitalização
    const entradas = Object.entries(contato);
    let nome = '';
    let telefone = '';
    let ativo = true;
    
    for (const [chave, valor] of entradas) {
      if (!chave) continue;
      
      const chaveLower = String(chave).toLowerCase();
      
      if (chaveLower.includes('nome')) {
        nome = valor;
      } else if (
        chaveLower.includes('telefone') || 
        chaveLower.includes('celular') || 
        chaveLower.includes('whatsapp') || 
        chaveLower.includes('fone') ||
        chaveLower.includes('phone') ||
        chaveLower.includes('numero')
      ) {
        telefone = valor;
      } else if (
        chaveLower.includes('ativo') || 
        chaveLower.includes('status') || 
        chaveLower.includes('habilitado')
      ) {
        // Considerar o contato ativo se o campo for 'sim', 'true', 1, etc.
        if (typeof valor === 'string') {
          const valorLower = String(valor).toLowerCase();
          ativo = valorLower === 'sim' || valorLower === 'true' || valorLower === 's' || valorLower === 'y' || valorLower === 'yes';
        } else {
          ativo = Boolean(valor);
        }
      }
    }
    
    // Se não encontrar telefone, tentar encontrar algum campo que pareça ser um número
    if (!telefone) {
      for (const [chave, valor] of entradas) {
        // Verificar se o valor se parece com um número de telefone
        if (valor && typeof valor === 'string' && valor.replace(/\D/g, '').length >= 8) {
          telefone = valor;
          break;
        }
      }
    }
    
    // Garantir que telefone seja uma string antes de aplicar replace
    let telefoneFormatado = '';
    if (telefone !== undefined && telefone !== null) {
      // Normalizar o telefone (remover caracteres não numéricos)
      telefoneFormatado = String(telefone).replace(/\D/g, '');
      
      // Adicionar código do país (55) se não estiver presente e for um número brasileiro
      if (telefoneFormatado.length >= 10 && telefoneFormatado.length <= 11 && !telefoneFormatado.startsWith('55')) {
        telefoneFormatado = `55${telefoneFormatado}`;
      }
    }
    
    return {
      nome: nome || 'Sem nome',
      telefone: telefoneFormatado,
      ativo: ativo
    };
  })
  // Filtrar contatos sem telefone ou inativos
  .filter(contato => {
    // Verificar se o telefone é válido (pelo menos 10 dígitos)
    const telefoneValido = contato.telefone && contato.telefone.length >= 10;
    
    return telefoneValido && contato.ativo;
  });
  
  logger.debug(`Processados ${dados.length} contatos, encontrados ${contatosProcessados.length} válidos`);
  return contatosProcessados;
}

// Função principal para obter todos os contatos de todos os arquivos
async function obterContatos(forcarReload = false) {
  try {
    // Verificar se o cache é válido
    if (!forcarReload && verificarCacheContatos()) {
      logger.debug('Usando cache de contatos');
      return contatosCache;
    }
    
    const arquivos = obterArquivosContatos();
    
    if (arquivos.length === 0) {
      logger.warn('Nenhum arquivo de contatos encontrado no diretório');
      
      // Atualizar o cache
      contatosCache = [];
      ultimaAtualizacaoContatos = new Date();
      
      return [];
    }
    
    let todosContatos = [];
    
    for (const arquivo of arquivos) {
      const caminhoArquivo = path.join(CONTATOS_DIR, arquivo);
      const extensao = path.extname(arquivo).toLowerCase();
      
      logger.info(`Lendo contatos do arquivo: ${arquivo}`);
      
      let contatos = [];
      if (extensao === '.xlsx') {
        contatos = await lerContatosExcel(caminhoArquivo);
      } else if (extensao === '.csv') {
        contatos = await lerContatosCsv(caminhoArquivo);
      }
      
      logger.debug(`${contatos.length} contatos válidos em ${arquivo}`);
      todosContatos = todosContatos.concat(contatos);
    }
    
    // Remover duplicatas baseadas no número de telefone
    const contatosUnicos = {};
    todosContatos.forEach(contato => {
      contatosUnicos[contato.telefone] = contato;
    });
    
    const resultado = Object.values(contatosUnicos);
    logger.info(`Total de ${resultado.length} contatos únicos encontrados`);
    
    // Atualizar o cache
    contatosCache = resultado;
    ultimaAtualizacaoContatos = new Date();
    
    return resultado;
  } catch (erro) {
    logger.error(`Erro ao obter contatos: ${erro.message}`);
    return [];
  }
}

// Adicionar um novo contato à planilha
async function adicionarNovoContatoNaPlanilha(telefone, nomeContato = "Novo Contato") {
  try {
    const arquivos = obterArquivosContatos();
    
    if (arquivos.length === 0) {
      logger.info('Nenhum arquivo de contatos encontrado. Criando novo arquivo.');
      return criarNovoArquivoContatos(telefone, nomeContato);
    }
    
    // Usar o primeiro arquivo encontrado
    const arquivoContatos = path.join(CONTATOS_DIR, arquivos[0]);
    const extensao = path.extname(arquivoContatos).toLowerCase();
    
    let resultado = false;
    
    // Verificar se é Excel ou CSV
    if (extensao === '.xlsx') {
      resultado = await adicionarContatoExcel(arquivoContatos, telefone, nomeContato);
    } else if (extensao === '.csv') {
      resultado = await adicionarContatoCsv(arquivoContatos, telefone, nomeContato);
    } else {
      logger.error(`Formato de arquivo não suportado: ${extensao}`);
      return false;
    }
    
    // Se o contato foi adicionado, invalidar o cache
    if (resultado) {
      contatosCache = null;
      ultimaAtualizacaoContatos = null;
    }
    
    return resultado;
  } catch (erro) {
    logger.error(`Erro ao adicionar novo contato ${telefone}: ${erro.message}`);
    return false;
  }
}

// Adicionar contato a um arquivo Excel
async function adicionarContatoExcel(caminhoArquivo, telefone, nomeContato) {
  try {
    logger.info(`Adicionando contato ${telefone} ao arquivo Excel`);
    
    // Formatar o telefone conforme o padrão
    const telefoneFormatado = formatarTelefone(telefone);
    
    // Ler o arquivo Excel existente
    const workbook = xlsx.readFile(caminhoArquivo, {
      cellDates: true,
      cellNF: true,
      cellText: true
    });
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      logger.error('Arquivo Excel sem planilhas');
      return false;
    }
    
    // Usar a primeira planilha
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Converter para JSON para manipulação
    const dados = xlsx.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false
    });
    
    // Verificar se o contato já existe
    const contatoExistente = dados.some(contato => {
      // Normalizar números de telefone para comparação
      const telefoneExistente = String(contato.Telefone || '').replace(/\D/g, '');
      const telefoneNovo = telefoneFormatado.replace(/\D/g, '');
      
      return telefoneExistente === telefoneNovo || 
             telefoneExistente === telefoneNovo.replace(/^55/, '') || 
             `55${telefoneExistente}` === telefoneNovo;
    });
    
    if (contatoExistente) {
      logger.debug(`Contato ${telefone} já existe na planilha`);
      return false;
    }
    
    // Adicionar o novo contato
    const novoContato = {
      Nome: nomeContato,
      Telefone: telefoneFormatado,
      Ativo: 'Sim',
      Observacoes: `Adicionado automaticamente em ${new Date().toLocaleDateString()}`
    };
    
    dados.push(novoContato);
    
    // Converter de volta para planilha
    const novaWorksheet = xlsx.utils.json_to_sheet(dados);
    workbook.Sheets[sheetName] = novaWorksheet;
    
    // Salvar o arquivo atualizado
    xlsx.writeFile(workbook, caminhoArquivo);
    
    logger.info(`Novo contato ${telefoneFormatado} (${nomeContato}) adicionado à planilha`);
    return true;
  } catch (erro) {
    logger.error(`Erro ao adicionar contato no Excel: ${erro.message}`);
    return false;
  }
}

// Adicionar contato a um arquivo CSV
async function adicionarContatoCsv(caminhoArquivo, telefone, nomeContato) {
  try {
    logger.info(`Adicionando contato ${telefone} ao arquivo CSV`);
    
    // Formatar o telefone conforme o padrão
    const telefoneFormatado = formatarTelefone(telefone);
    
    // Ler o arquivo CSV existente
    const contatos = await new Promise((resolve, reject) => {
      const linhas = [];
      
      fs.createReadStream(caminhoArquivo)
        .pipe(csvParser())
        .on('data', (row) => {
          linhas.push(row);
        })
        .on('end', () => {
          resolve(linhas);
        })
        .on('error', (erro) => {
          reject(erro);
        });
    });
    
    // Verificar se o contato já existe
    const contatoExistente = contatos.some(contato => {
      // Normalizar números de telefone para comparação
      const telefoneExistente = String(contato.Telefone || '').replace(/\D/g, '');
      const telefoneNovo = telefoneFormatado.replace(/\D/g, '');
      
      return telefoneExistente === telefoneNovo || 
             telefoneExistente === telefoneNovo.replace(/^55/, '') || 
             `55${telefoneExistente}` === telefoneNovo;
    });
    
    if (contatoExistente) {
      logger.debug(`Contato ${telefone} já existe no arquivo CSV`);
      return false;
    }
    
    // Adicionar o novo contato
    const novoContato = {
      Nome: nomeContato,
      Telefone: telefoneFormatado,
      Ativo: 'Sim',
      Observacoes: `Adicionado automaticamente em ${new Date().toLocaleDateString()}`
    };
    
    contatos.push(novoContato);
    
    // Obter os cabeçalhos
    const cabecalhos = Object.keys(contatos[0]);
    
    // Criar o conteúdo CSV
    const csvContent = [
      cabecalhos.join(','),
      ...contatos.map(contato => 
        cabecalhos.map(cabecalho => 
          `"${String(contato[cabecalho] || '').replace(/\"/g, '""')}"`)
        .join(',')
      )
    ].join('\n');
    
    // Salvar o arquivo atualizado
    fs.writeFileSync(caminhoArquivo, csvContent, 'utf8');
    
    logger.info(`Novo contato ${telefoneFormatado} (${nomeContato}) adicionado ao CSV`);
    return true;
  } catch (erro) {
    logger.error(`Erro ao adicionar contato no CSV: ${erro.message}`);
    return false;
  }
}

// Criar novo arquivo de contatos se não existir nenhum
function criarNovoArquivoContatos(telefone, nomeContato) {
  try {
    logger.info('Criando novo arquivo de contatos...');
    
    // Garantir que o diretório existe
    if (!fs.existsSync(CONTATOS_DIR)) {
      fs.mkdirSync(CONTATOS_DIR, { recursive: true });
    }
    
    // Formatar o telefone conforme o padrão
    const telefoneFormatado = formatarTelefone(telefone);
    
    // Criar dados iniciais
    const contatos = [
      {
        Nome: nomeContato,
        Telefone: telefoneFormatado,
        Ativo: 'Sim',
        Observacoes: `Adicionado automaticamente em ${new Date().toLocaleDateString()}`
      }
    ];
    
    // Criar arquivo Excel
    const caminhoArquivo = path.join(CONTATOS_DIR, 'contatos.xlsx');
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(contatos);
    
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contatos');
    xlsx.writeFile(workbook, caminhoArquivo);
    
    logger.info(`Novo arquivo de contatos criado com o contato ${telefoneFormatado}`);
    
    // Invalidar o cache
    contatosCache = null;
    ultimaAtualizacaoContatos = null;
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao criar novo arquivo de contatos: ${erro.message}`);
    return false;
  }
}

// Função auxiliar para formatar número de telefone
function formatarTelefone(telefone) {
  // Remover caracteres não numéricos
  let telefoneFormatado = String(telefone).replace(/\D/g, '');
  
  // Adicionar código do país (55) se não estiver presente e for um número brasileiro
  if (telefoneFormatado.length >= 10 && telefoneFormatado.length <= 11 && !telefoneFormatado.startsWith('55')) {
    telefoneFormatado = `55${telefoneFormatado}`;
  }
  
  return telefoneFormatado;
}

// Limpar o cache de contatos
function limparCacheContatos() {
  contatosCache = null;
  ultimaAtualizacaoContatos = null;
  logger.debug('Cache de contatos limpo');
}

module.exports = {
  obterContatos,
  adicionarNovoContatoNaPlanilha,
  limparCacheContatos
};