// Módulo de conexão com WhatsApp usando Baileys (Otimizado)

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const { logger, esperar } = require('./utils');
const historicoMensagens = require('./historicoMensagens');
const { adicionarNovoContatoNaPlanilha } = require('./leitorContatos');
const conversasHandler = require('./conversasHandler');

// Configurações
const AUTH_FOLDER = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
const TEMPO_ONLINE = parseInt(process.env.TEMPO_ONLINE || '60000', 10); // 1 minuto por padrão
const RETRY_INTERVAL = parseInt(process.env.RETRY_INTERVAL || '5000', 10); // 5 segundos
const MAX_RESPOSTAS_PADRAO = 5; // Número máximo de mensagens padrão carregadas
const RESPONDER_AUTOMATICAMENTE = process.env.RESPONDER_AUTOMATICAMENTE !== 'false';

// Cliente WhatsApp
let wa = null;
let clienteInicializado = false;
let timerPresenca = null;
let tentativasConexao = 0;
const MAX_TENTATIVAS_CONEXAO = 5;

// Cache de respostas padrão para mensagens simples
const respostasPadraoCache = [
  "Amém! Tenha um dia abençoado.",
  "Que Deus te abençoe hoje e sempre.",
  "Obrigado por compartilhar. Fique na paz de Cristo.",
  "Louvado seja Deus! Tenha um excelente dia.",
  "Que a graça de Deus esteja com você hoje."
];

// Cache de respostas para áudios
const respostasAudioCache = [
  "Olá! Recebi seu áudio, mas ainda não consigo processá-lo. Você poderia, por gentileza, enviar sua pergunta ou comentário como mensagem de texto? Assim poderei lhe ajudar melhor. 🙏",
  "Agradeço pelo seu áudio! No momento, não disponho da capacidade de ouvi-lo. Poderia, por favor, compartilhar seu pensamento ou pergunta em forma de texto? Ficarei feliz em responder!",
  "Recebi sua mensagem de voz! Infelizmente, ainda não consigo compreender áudios. Se puder enviar o mesmo conteúdo em texto, será um prazer conversar sobre o devocional de hoje ou qualquer outro assunto espiritual."
];

// Função para definir o status como offline
async function definirOffline() {
  try {
    if (wa && clienteInicializado) {
      await wa.sendPresenceUpdate('unavailable', null);
      logger.debug('Status definido como offline (visto por último)');
    }
  } catch (erro) {
    logger.error(`Erro ao definir status offline: ${erro.message}`);
  }
}

// Função para gerenciar o status online
async function gerenciarPresenca() {
  // Limpar o timer existente, se houver
  if (timerPresenca) {
    clearTimeout(timerPresenca);
  }

  // Definir um novo timer para ficar offline após o tempo configurado
  timerPresenca = setTimeout(definirOffline, TEMPO_ONLINE);
}

// Extrair o conteúdo de uma mensagem WhatsApp
function extrairConteudoMensagem(msg) {
  if (!msg.message) return "";
  
  // Identificar o tipo de mensagem
  const messageType = Object.keys(msg.message)[0];
  
  // Extrair o conteúdo baseado no tipo
  switch (messageType) {
    case 'conversation':
      return msg.message.conversation;
    case 'extendedTextMessage':
      return msg.message.extendedTextMessage.text;
    case 'audioMessage':
    case 'pttMessage':
      return "[Mensagem de áudio]";
    case 'imageMessage':
      return msg.message.imageMessage?.caption || "[Imagem]";
    case 'videoMessage':
      return msg.message.videoMessage?.caption || "[Vídeo]";
    case 'documentMessage':
      return "[Documento]";
    case 'stickerMessage':
      return "[Sticker]";
    default:
      return `[Mensagem tipo: ${messageType}]`;
  }
}

// Obter nome formatado do contato
function obterNomeContato(msg) {
  // Tente pelo pushName que pode estar disponível na própria mensagem
  if (msg.pushName) {
    return msg.pushName;
  }
  // Ou pelo objeto key da mensagem
  else if (msg.key && msg.key.pushName) {
    return msg.key.pushName;
  }
  
  return "Novo Contato";
}

let qrGerado = false;
let conexaoEstabelecida = false;

// Inicializar o cliente WhatsApp
async function iniciarCliente() {
  try {
    logger.info('Inicializando cliente WhatsApp...');

    // Resetar flags
    qrGerado = false;
    conexaoEstabelecida = false;

    // Garantir que a pasta de autenticação existe
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
      logger.info(`Diretório de autenticação criado: ${AUTH_FOLDER}`);
    }

    // Carregar estado de autenticação
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    // Logger silencioso para o Baileys
    const nullLogger = {
      child: () => nullLogger,
      info: () => { },
      warn: () => { },
      error: () => { },
      debug: () => { },
      trace: () => { }
    };

    // Criar o socket WhatsApp
    wa = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      defaultQueryTimeoutMs: 120000, // Timeout mais longo (2 minutos)
      logger: nullLogger,
      browser: ['WhatsApp Devocional', 'Chrome', '10.0'], // Nome amigável
      connectTimeoutMs: 60000, // 60 segundos para conexão
      qrTimeout: 60000 * 5 // 5 minutos para escanear o QR
    });

    // Manipular eventos de conexão
    wa.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
    
      if (qr) {
        qrGerado = true;
        logger.info('QR Code gerado. Escaneie-o com seu WhatsApp:');
        logger.info('Você tem até 5 minutos para escanear este QR code.');
        qrcode.generate(qr, { small: true });
      }
    
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'erro desconhecido';
        
        logger.warn(`Conexão fechada devido a ${errorMessage} (código: ${statusCode})`);
    
        clienteInicializado = false;
        conexaoEstabelecida = false;
    
        // DisconnectReason.restartRequired = 515
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        // Se o erro for "restartRequired", tentar reconectar após pausa maior
        if (statusCode === DisconnectReason.restartRequired) {
          logger.info('Reinício necessário, pausando antes de tentar novamente...');
          
          // Limpar os arquivos de sessão para um início limpo
          try {
            // Criar backup da sessão atual
            const backupDir = `${AUTH_FOLDER}_backup_${Date.now()}`;
            if (fs.existsSync(AUTH_FOLDER)) {
              fs.copySync(AUTH_FOLDER, backupDir);
              // Opcional: remover arquivos da sessão atual para começar do zero
              // fs.removeSync(AUTH_FOLDER);
              // fs.mkdirSync(AUTH_FOLDER, { recursive: true });
            }
            logger.info(`Backup da sessão anterior criado em ${backupDir}`);
          } catch (backupError) {
            logger.warn(`Não foi possível fazer backup da sessão: ${backupError.message}`);
          }
          
          // Pausa maior antes de tentar reconectar para "restartRequired"
          setTimeout(() => {
            logger.info('Tentando reiniciar o cliente WhatsApp...');
            iniciarCliente();
          }, 15000); // 15 segundos de pausa
          
          return;
        }
    
        if (shouldReconnect && tentativasConexao < MAX_TENTATIVAS_CONEXAO) {
          tentativasConexao++;
          const tempoEspera = RETRY_INTERVAL * tentativasConexao; // Tempo progressivo
          logger.info(`Tentando reconectar (${tentativasConexao}/${MAX_TENTATIVAS_CONEXAO}) em ${tempoEspera/1000}s...`);
          setTimeout(iniciarCliente, tempoEspera);
        } else if (tentativasConexao >= MAX_TENTATIVAS_CONEXAO) {
          logger.error(`Número máximo de tentativas de reconexão atingido (${MAX_TENTATIVAS_CONEXAO})`);
          // Redefinir contador após algum tempo para permitir novas tentativas mais tarde
          setTimeout(() => { tentativasConexao = 0; }, 60 * 60 * 1000); // 1 hora
        }
      } else if (connection === 'open') {
        logger.info('Cliente WhatsApp conectado com sucesso!');
        clienteInicializado = true;
        conexaoEstabelecida = true;
        tentativasConexao = 0; // Resetar contador de tentativas
    
        // Definir como online inicialmente
        await wa.sendPresenceUpdate('available', null);
        gerenciarPresenca();
      }
    });

    // Salvar credenciais quando atualizadas
    wa.ev.on('creds.update', saveCreds);

    // Manipular mensagens recebidas
    wa.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          // Processar apenas mensagens de outros (não enviadas por nós)
          if (!msg.key.fromMe) {
            await processarMensagemRecebida(msg);
          }
        }
      }
    });

    logger.info('Sistema de eventos do WhatsApp inicializado. Aguardando conexão...');
    
    // Aguardar até que a conexão seja estabelecida ou um QR code seja gerado
    return wa;
  } catch (erro) {
    logger.error(`Erro ao inicializar cliente WhatsApp: ${erro.message}`);
    
    // Tentar novamente mais tarde se não excedeu o número máximo de tentativas
    if (tentativasConexao < MAX_TENTATIVAS_CONEXAO) {
      tentativasConexao++;
      logger.info(`Tentando inicializar novamente (${tentativasConexao}/${MAX_TENTATIVAS_CONEXAO}) em ${RETRY_INTERVAL/1000}s`);
      setTimeout(iniciarCliente, RETRY_INTERVAL);
    }
    
    return null;
  }
}

// Adicionar esta função para esperar até que a conexão seja estabelecida
async function aguardarConexao(timeoutMs = 300000) { // 5 minutos padrão
  const inicio = Date.now();
  
  while (!conexaoEstabelecida) {
    // Verificar timeout
    if (Date.now() - inicio > timeoutMs) {
      throw new Error('Tempo esgotado aguardando a conexão do WhatsApp');
    }
    
    // Pequena pausa para não consumir CPU
    await esperar(1000);
    
    // Se o QR code foi gerado, dar mais tempo para escanear
    if (qrGerado) {
      await esperar(5000); // Pausa maior quando o QR code foi gerado
    }
  }
  
  return true;
}

// Limpar a sessão se continuar dando falhas de conexão
async function limparSessao() {
  try {
    // Parar cliente atual se existir
    if (wa) {
      try {
        wa.ev.removeAllListeners();
        wa = null;
      } catch (e) {
        // Ignorar erros ao fechar
      }
    }
    
    clienteInicializado = false;
    conexaoEstabelecida = false;
    
    // Fazer backup e limpar diretório de sessão
    if (fs.existsSync(AUTH_FOLDER)) {
      const backupDir = `${AUTH_FOLDER}_backup_${Date.now()}`;
      fs.copySync(AUTH_FOLDER, backupDir);
      fs.removeSync(AUTH_FOLDER);
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
      logger.info(`Sessão anterior limpa. Backup criado em ${backupDir}`);
    }
    
    // Zerar contadores
    tentativasConexao = 0;
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao limpar sessão: ${erro.message}`);
    return false;
  }
}

// Processar mensagens recebidas
async function processarMensagemRecebida(msg) {
  try {
    // Verificar se as respostas automáticas estão ativadas
    if (!RESPONDER_AUTOMATICAMENTE) {
      logger.debug('Respostas automáticas desativadas. Ignorando mensagem recebida.');
      return;
    }

    // Verificar se é uma mensagem de grupo
    if (msg.key.remoteJid.includes('@g.us')) {
      return; // Ignorar mensagens de grupos
    }

    // Obter informações do remetente
    const remetente = msg.key.remoteJid;
    const telefone = remetente.split('@')[0];
    const nomeContato = obterNomeContato(msg);

    // Verificar se não é uma mensagem muito antiga
    const timestampMensagem = msg.messageTimestamp * 1000;
    const agora = Date.now();
    const diffMinutos = (agora - timestampMensagem) / (1000 * 60);

    if (diffMinutos > 10) {
      logger.debug(`Ignorando mensagem antiga de ${telefone} (${Math.floor(diffMinutos)} minutos atrás)`);
      return;
    }

    // Ao receber uma mensagem, definir como online
    await wa.sendPresenceUpdate('available', remetente);
    gerenciarPresenca();

    // Verificar se é o primeiro contato do usuário
    const ehPrimeiraInteracao = await conversasHandler.isPrimeiraInteracao(telefone);

    // Se for primeira interação, adicionar aos contatos e enviar o devocional atual
    if (ehPrimeiraInteracao) {
      logger.info(`Primeira interação detectada para ${telefone} (${nomeContato})`);

      try {
        // Adicionar à planilha de contatos
        await adicionarNovoContatoNaPlanilha(telefone, nomeContato);
        logger.info(`Contato ${telefone} (${nomeContato}) adicionado à planilha`);

        // Enviar devocional de boas-vindas
        await enviarDevocionalBoasVindas(remetente, telefone);
        return;
      } catch (erroContato) {
        logger.error(`Erro ao processar novo contato: ${erroContato.message}`);
      }
    }

    // Identificar tipo de mensagem
    const messageType = Object.keys(msg.message || {})[0];
    const conteudo = extrairConteudoMensagem(msg);

    // Processar áudio
    if (['audioMessage', 'pttMessage'].includes(messageType)) {
      logger.debug(`Áudio recebido de ${telefone}, respondendo com mensagem padrão`);

      // Escolher uma mensagem aleatória do cache
      const respostaAudio = respostasAudioCache[Math.floor(Math.random() * respostasAudioCache.length)];

      // Simular digitação e enviar resposta
      await simularDigitacaoEEnviar(remetente, respostaAudio, 2000);
      return;
    }

    logger.debug(`Mensagem recebida de ${telefone}: ${conteudo.substring(0, 30)}${conteudo.length > 30 ? '...' : ''}`);

    // Verificar se a mensagem precisa de resposta elaborada
    if (conversasHandler.ePergunta(conteudo) || conteudo.length >= 10) {
      logger.debug(`Gerando resposta para pergunta de ${telefone}`);

      // Simular "digitando..."
      await wa.sendPresenceUpdate('composing', remetente);

      // Gerar a resposta
      const resposta = await conversasHandler.gerarRespostaParaMensagem(telefone, conteudo);

      // Calcular tempo natural de digitação (entre 3-8 segundos, ajustado pelo tamanho)
      const tempoDigitacao = Math.min(Math.max(resposta.length / 10 * 1000, 3000), 8000);
      
      // Simular digitação e enviar
      await simularDigitacaoEEnviar(remetente, resposta, tempoDigitacao);
    } else {
      logger.debug(`Mensagem curta de ${telefone}, enviando resposta simples`);

      // Para mensagens curtas ou agradecimentos, enviar uma resposta simples
      const respostaPadrao = respostasPadraoCache[Math.floor(Math.random() * respostasPadraoCache.length)];
      
      // Registrar no histórico de conversas
      await conversasHandler.gerarRespostaParaMensagem(telefone, conteudo);
      
      // Simular digitação e enviar resposta padrão
      await simularDigitacaoEEnviar(remetente, respostaPadrao, 1500);
    }
  } catch (erro) {
    logger.error(`Erro ao processar mensagem: ${erro.message}`);
    try {
      // Tentar enviar uma mensagem de erro para o usuário
      if (msg.key?.remoteJid) {
        await wa.sendMessage(msg.key.remoteJid, {
          text: "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente mais tarde."
        });
      }
    } catch (erroEnvio) {
      logger.error(`Erro ao enviar mensagem de erro: ${erroEnvio.message}`);
    }
  }
}

// Enviar mensagem simulando digitação natural
async function simularDigitacaoEEnviar(destinatario, mensagem, tempoDigitacao = 2000) {
  try {
    // Indicar que está digitando
    await wa.sendPresenceUpdate('composing', destinatario);
    
    // Simular tempo de digitação
    await esperar(tempoDigitacao);
    
    // Parar de "digitar"
    await wa.sendPresenceUpdate('paused', destinatario);
    
    // Pequena pausa como se estivesse revisando
    await esperar(500);
    
    // Enviar a mensagem
    await wa.sendMessage(destinatario, { text: mensagem });
    
    // Reiniciar o timer de presença
    gerenciarPresenca();
    
    return true;
  } catch (erro) {
    logger.error(`Erro ao enviar mensagem: ${erro.message}`);
    return false;
  }
}

// Enviar devocional de boas-vindas para novos contatos
async function enviarDevocionalBoasVindas(remetente, telefone) {
  try {
    // Buscar o último devocional enviado hoje
    const devocionalHoje = await historicoMensagens.obterUltimoDevocionalEnviado();
    
    if (devocionalHoje) {
      // Enviar mensagem de boas-vindas
      await wa.sendMessage(remetente, {
        text: `*Bem-vindo ao Devocional-IA* 🙏📱
Olá! Seja Bem-vindo ao *Whatsapp Devocionals-IA*, devocionais diários totalmente automatizado.\n
Como Funciona?
- *Receba diariamente* um devocional único criado por inteligência artificial
- *Interaja respondendo* a qualquer momento
- *Explore reflexões* personalizadas e inspiradoras
- *Novos devocionais* todos os dias 06:00 da manhã

Aqui vai o devocional de hoje, Deus abençoe!`
      });
      
      // Pequena pausa
      await esperar(1500);
      
      // Enviar o devocional
      await wa.sendMessage(remetente, { text: devocionalHoje });
      
      // Registrar o devocional enviado para este contato
      await conversasHandler.registrarDevocionalEnviado(telefone, devocionalHoje);
      logger.info(`Devocional do dia enviado para novo contato: ${telefone}`);
      return true;
    } else {
      // Se não encontrou devocional, gerar um novo
      logger.warn(`Não encontrou devocional para enviar ao novo contato ${telefone}`);
      
      try {
        // Importar o gerador de devocional
        const geradorDevocional = require('./geradorDevocional');
        const { formatarData } = require('./utils');
        
        const dataAtual = formatarData(new Date());
        const novoDevocional = await geradorDevocional.gerarDevocional(dataAtual);
        
        if (novoDevocional) {
          // Enviar mensagem de boas-vindas
          await wa.sendMessage(remetente, {
            text: "Olá 😀! Seja bem-vindo(a) ao Whatsapp Devocional-IA. Aqui está o devocional de hoje:"
          });
          
          // Pequena pausa
          await esperar(1500);
          
          // Enviar o devocional gerado
          await wa.sendMessage(remetente, { text: novoDevocional });
          
          // Registrar o devocional
          await conversasHandler.registrarDevocionalEnviado(telefone, novoDevocional);
          historicoMensagens.registrarEnvio({
            data: dataAtual,
            devocional: novoDevocional,
            totalContatos: 1,
            enviosComSucesso: 1
          });
          
          logger.info(`Novo devocional gerado e enviado para contato: ${telefone}`);
          return true;
        }
      } catch (erroGeracao) {
        logger.error(`Erro ao gerar devocional para novo contato: ${erroGeracao.message}`);
      }
      
      // Se falhou em gerar um devocional
      await wa.sendMessage(remetente, {
        text: "Olá! Seja bem-vindo(a) ao Whatsapp Devocional-IA. Nosso sistema está preparando o devocional de hoje. Por favor, tente novamente em alguns instantes."
      });
      
      return false;
    }
  } catch (erro) {
    logger.error(`Erro ao enviar devocional de boas-vindas: ${erro.message}`);
    return false;
  }
}

// Verificar se o cliente está pronto
function clientePronto() {
  return wa !== null && clienteInicializado;
}

// Enviar mensagem para um contato
async function enviarMensagem(telefone, mensagem) {
  try {
    if (!clientePronto()) {
      throw new Error('Cliente WhatsApp não está pronto');
    }

    // Formatar o número de telefone (remover caracteres não numéricos)
    const numeroFormatado = telefone.toString().replace(/\D/g, '');

    // Garantir que o número tenha o formato correto para o WhatsApp
    const chatId = `${numeroFormatado}@s.whatsapp.net`;

    // Definir como online ao enviar mensagem
    await wa.sendPresenceUpdate('available', chatId);

    // Enviar a mensagem
    await wa.sendMessage(chatId, { text: mensagem });

    // Iniciar o timer para ficar offline
    gerenciarPresenca();

    return true;
  } catch (erro) {
    logger.error(`Erro ao enviar mensagem para ${telefone}: ${erro.message}`);
    throw erro;
  }
}

// Encerrar o cliente
async function encerrarCliente() {
  try {
    if (wa) {
      // Definir como offline antes de desconectar
      try {
        await definirOffline();
      } catch (erroPresenca) {
        logger.warn(`Erro ao definir offline antes de encerrar: ${erroPresenca.message}`);
      }

      // Limpar o timer de presença
      if (timerPresenca) {
        clearTimeout(timerPresenca);
        timerPresenca = null;
      }

      // Não há um método específico para "destruir" no Baileys,
      // mas podemos remover os listeners e limpar referências
      wa.ev.removeAllListeners();
      wa = null;
      clienteInicializado = false;
      logger.info('Cliente WhatsApp encerrado');
    }
  } catch (erro) {
    logger.error(`Erro ao encerrar cliente WhatsApp: ${erro.message}`);
  }
}

module.exports = {
  iniciarCliente,
  clientePronto,
  enviarMensagem,
  encerrarCliente,
  aguardarConexao,
  limparSessao,
};