// WhatsApp Devocional Diário com IA (Otimizado)
// Ponto de entrada da aplicação

require('dotenv').config();
const schedule = require('node-schedule');
const express = require('express');
const path = require('path');
const moment = require('moment');
const fs = require('fs');
moment.locale('pt-br');

// Importe a variável qrCodeDataUrl de whatsapp.js
const { qrCodeDataUrl } = require('./whatsapp');

// Importação dos módulos
const whatsapp = require('./whatsapp');
const geradorDevocional = require('./geradorDevocional');
const leitorContatos = require('./leitorContatos');
const historicoMensagens = require('./historicoMensagens');
const conversasHandler = require('./conversasHandler');
const leitorDocumentos = require('./leitorDocumentos');
const { criarDiretorios, formatarData, logger, esperar } = require('./utils');

// Garantir que os diretórios necessários existam
criarDiretorios();

// Configurações
const SCHEDULE_TIME = process.env.SCHEDULE_TIME || '07:00';
const ENVIAR_IMEDIATAMENTE = process.env.ENVIAR_IMEDIATAMENTE === 'true';
const RETRY_INTERVAL = parseInt(process.env.RETRY_INTERVAL || '300000', 10); // 5 minutos em ms


// Contador global de erros de conexão
let errosConexaoGlobal = 0;
const MAX_ERROS_CONEXAO = 3;

// Flag para controlar as tentativas de envio
let envioEmAndamento = false;
let ultimoEnvioFalhou = false;

// Função principal que executa o envio dos devocionais
async function enviarDevocionaisDiarios() {
  try {
    // Evitar múltiplas chamadas simultâneas
    if (envioEmAndamento) {
      logger.warn('Envio já está em andamento. Ignorando chamada duplicada.');
      return;
    }
    
    envioEmAndamento = true;
    logger.info('Iniciando o processo de envio de devocionais diários');
    
    // Obter a data atual formatada
    const dataAtual = formatarData(new Date());
    
    // Gerar o devocional do dia
    logger.info('Gerando devocional...');
    const devocional = await geradorDevocional.gerarDevocional(dataAtual);
    logger.info('Devocional gerado com sucesso');
    
    // Extrair o versículo para registro (uma única vez)
    const versiculo = historicoMensagens.extrairVersiculo(devocional);
    
    // IMPORTANTE: Registrar o devocional no histórico ANTES de enviá-lo
    const registroSucesso = historicoMensagens.registrarEnvio({
      data: dataAtual,
      devocional: devocional,
      versiculo: versiculo,
      totalContatos: 0, // Será atualizado depois
      enviosComSucesso: 0 // Será atualizado depois
    });
    
    if (!registroSucesso) {
      logger.error('Falha ao registrar devocional no histórico geral');
    }
    
    // Verificar se o cliente WhatsApp está pronto
    if (!whatsapp.clientePronto()) {
      logger.error('Cliente WhatsApp não está pronto. Agendando nova tentativa...');
      ultimoEnvioFalhou = true;
      envioEmAndamento = false;
      setTimeout(enviarDevocionaisDiarios, RETRY_INTERVAL);
      return;
    }
    
    // Obter a lista de contatos
    logger.info('Obtendo lista de contatos...');
    const contatos = await leitorContatos.obterContatos();
    logger.info(`${contatos.length} contatos encontrados`);
    
    if (contatos.length === 0) {
      logger.warn('Nenhum contato para enviar devocional. Verificar arquivo de contatos.');
      envioEmAndamento = false;
      return;
    }
    
    // Enviar o devocional para cada contato, com controle de falhas
    let enviosComSucesso = 0;
    
    for (const contato of contatos) {
      try {
        logger.debug(`Enviando devocional para ${contato.nome} (${contato.telefone})...`);
        await whatsapp.enviarMensagem(contato.telefone, devocional);
        
        // Registrar o devocional enviado para referência em conversas futuras
        await conversasHandler.registrarDevocionalEnviado(contato.telefone, devocional);
        
        enviosComSucesso++;
      } catch (erro) {
        logger.error(`Erro ao enviar devocional para ${contato.nome}: ${erro.message}`);
        // Continuar com os próximos contatos mesmo com falha
      }
      
      // Pequena pausa entre envios para não sobrecarregar
      await esperar(300);
    }
    
    // Atualizar o histórico com os números finais
    historicoMensagens.registrarEnvio({
      data: dataAtual,
      devocional: devocional,
      versiculo: versiculo,
      totalContatos: contatos.length,
      enviosComSucesso: enviosComSucesso
    });
    
    logger.info(`Processo concluído. Enviado para ${enviosComSucesso}/${contatos.length} contatos.`);
    
    if (versiculo) {
      logger.info(`Versículo enviado hoje: ${versiculo.referencia} - "${versiculo.texto}"`);
    }
    
    // Verificar se o devocional pode ser recuperado do histórico (validação)
    const devocionalRecuperado = await historicoMensagens.obterUltimoDevocionalEnviado();
    if (!devocionalRecuperado) {
      logger.error('PROBLEMA: Não foi possível recuperar o devocional do histórico após registro');
    }
    
    ultimoEnvioFalhou = false;
    envioEmAndamento = false;
  } catch (erro) {
    logger.error(`Erro ao executar o processo de envio: ${erro.message}`);
    ultimoEnvioFalhou = true;
    envioEmAndamento = false;
    
    // Tentar novamente após intervalo de falha
    setTimeout(enviarDevocionaisDiarios, RETRY_INTERVAL);
  }
}

// Pré-processar a base de conhecimento
async function preprocessarBaseConhecimento() {
  try {
    logger.info('Iniciando pré-processamento da base de conhecimento...');
    const conteudoBase = await leitorDocumentos.obterConteudoBase();
    const tamanhoBase = Math.round(conteudoBase.length / 1024);
    logger.info(`Base de conhecimento processada: ${tamanhoBase} KB`);
    return true;
  } catch (erro) {
    logger.error(`Erro ao processar base de conhecimento: ${erro.message}`);
    return false;
  }
}

// Deteção e recuperação de falhas persistentes de conexão
function verificarProblemasConexao() {
  if (!whatsapp.clientePronto()) {
    errosConexaoGlobal++;
    
    if (errosConexaoGlobal >= MAX_ERROS_CONEXAO) {
      logger.error(`Detectados ${errosConexaoGlobal} erros consecutivos de conexão. Tentando recuperação de emergência...`);
      
      // Limpar completamente a sessão e reiniciar
      whatsapp.limparSessao().then(() => {
        logger.info('Sessão limpa. Reiniciando cliente em 10 segundos...');
        setTimeout(() => {
          // Reiniciar cliente do zero
          whatsapp.iniciarCliente();
        }, 10000);
      });
      
      // Resetar contador
      errosConexaoGlobal = 0;
    }
  } else {
    // Resetar contador quando a conexão está ok
    errosConexaoGlobal = 0;
  }
}

// Verificar a cada 5 minutos se há problemas persistentes
setInterval(verificarProblemasConexao, 5 * 60 * 1000);

// Inicialização do sistema
async function iniciarSistema() {
  try {
    logger.info('Iniciando o sistema WhatsApp Devocional IA...');
    
    // Processar a base de conhecimento em segundo plano
    preprocessarBaseConhecimento().then(sucesso => {
      if (!sucesso) {
        logger.warn('Houve um problema no processamento da base de conhecimento, mas o sistema continuará.');
      }
    });
    
    // Iniciar o cliente WhatsApp
    logger.info('Inicializando conexão com WhatsApp...');
    await whatsapp.iniciarCliente();
    
    // NOVO: Aguardar até que a conexão seja estabelecida
    logger.info('Aguardando que você escaneie o QR code e a conexão seja estabelecida...');
    try {
      await whatsapp.aguardarConexao(600000); // 10 minutos para estabelecer a conexão
      logger.info('Conexão WhatsApp estabelecida com sucesso!');
    } catch (erroConexao) {
      logger.error(`Erro ao estabelecer conexão: ${erroConexao.message}`);
      logger.info('Tentando novamente em alguns minutos...');
      setTimeout(iniciarSistema, RETRY_INTERVAL);
      return;
    }
    
    // Agendar o envio diário de devocionais no horário configurado
    const [hora, minuto] = SCHEDULE_TIME.split(':').map(Number);
    
    schedule.scheduleJob(`${minuto} ${hora} * * *`, async () => {
      logger.info(`Executando tarefa agendada de envio de devocionais (${SCHEDULE_TIME})`);
      // Verificar se o WhatsApp está conectado antes de prosseguir
      if (whatsapp.clientePronto()) {
        await enviarDevocionaisDiarios();
      } else {
        logger.error('Cliente WhatsApp não está pronto para envio do devocional agendado');
      }
    });
    
    logger.info(`Sistema iniciado. Devocionais serão enviados diariamente às ${SCHEDULE_TIME}`);
    
    // Para desenvolvimento/testes: enviar um devocional imediatamente se configurado
    if (ENVIAR_IMEDIATAMENTE) {
      logger.info('Configurado para enviar devocional imediatamente. Verificando se cliente está pronto...');
      // Verificar novamente se o cliente está pronto antes de enviar
      if (whatsapp.clientePronto()) {
        logger.info('Cliente pronto. Iniciando envio em 10 segundos...');
        setTimeout(enviarDevocionaisDiarios, 10000);
      } else {
        logger.warn('Cliente WhatsApp não está pronto. O envio imediato não será realizado.');
      }
    }
  } catch (erro) {
    logger.error(`Erro ao iniciar o sistema: ${erro.message}`);
    
    // Tentar reiniciar o sistema após um intervalo em caso de falha inicial
    setTimeout(iniciarSistema, RETRY_INTERVAL);
  }
}

// Inicialização do servidor web e do sistema
async function iniciarServidorESistema() {
  // Inicializar o servidor Express
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Servir arquivos estáticos da pasta 'public'
  app.use(express.static(path.join(__dirname, '../public')));

  // Endpoint para obter configurações
  app.get('/config', (req, res) => {
    // Retorna todas as variáveis de ambiente carregadas
    res.json(process.env);
  });
  
  // Adicione o middleware express.json() para parsear o corpo das requisições JSON
  app.use(express.json());

  // Endpoint para atualizar configurações
  app.post('/config', (req, res) => {
    const newConfig = req.body;
    let envFileContent = fs.readFileSync('.env', 'utf8');
    
    // Atualizar as linhas correspondentes no conteúdo lido
    for (const key in newConfig) {
      if (newConfig.hasOwnProperty(key)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        const newLine = `${key}=${newConfig[key]}`;
        envFileContent = envFileContent.replace(regex, newLine);
      }
    }

    // Escrever o conteúdo atualizado de volta no arquivo .env
    fs.writeFileSync('.env', envFileContent);
    res.status(200).send('Configurações atualizadas com sucesso!');
  });
  
  // Endpoint para obter o QR Code (placeholder)
  app.get('/qrcode', (req, res) => {
    res.json({ qrCodeUrl: qrCodeDataUrl });
  });

  // Iniciar o servidor Express
  app.listen(PORT, () => {
    logger.info(`Servidor web rodando em http://localhost:${PORT}`);
  });
}

// Tratamento de encerramento gracioso
process.on('SIGINT', async () => {
  logger.info('Encerrando o sistema...');
  await whatsapp.encerrarCliente();
  process.exit(0);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (erro) => {
  logger.error(`Erro não capturado: ${erro.message}`);
  logger.error(erro.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Promessa rejeitada não tratada:');
  logger.error(reason);
});

// Iniciar o servidor web e o sistema
iniciarServidorESistema();