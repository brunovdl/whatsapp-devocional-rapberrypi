// Script para testar o sistema de conversas individualizadas com IA

require('dotenv').config({ path: '../.env' });
const moment = require('moment');
moment.locale('pt-br');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

// Configurar o ambiente para execução independente
process.env.BASE_CONHECIMENTO_DIR = path.resolve(__dirname, '../Base_de_conhecimento');
process.env.CONVERSAS_DIR = path.resolve(__dirname, '../Conversas');

// Importar módulos
const conversasHandler = require('../src/conversasHandler');
const { formatarData, logger } = require('../src/utils');

// Configurar interface de linha de comando
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Telefone de teste
const TELEFONE_TESTE = '5511999999999';

// Devocional de exemplo para contextualizar a conversa
const devocionalExemplo = `${formatarData(new Date())}

Versículo: "Não andeis ansiosos por coisa alguma; antes em tudo sejam os vossos pedidos conhecidos diante de Deus pela oração e súplica com ações de graças. E a paz de Deus, que excede todo entendimento, guardará os vossos corações e as vossas mentes em Cristo Jesus." (Filipenses 4:6-7)

Reflexão: A ansiedade tem sido um desafio comum em nossos dias. Este versículo nos lembra que podemos trazer todas as nossas preocupações a Deus através da oração. Quando escolhemos confiar nEle ao invés de nos sobrecarregarmos com preocupações, experimentamos uma paz que vai além da compreensão humana. É uma promessa poderosa para nossos momentos de inquietação.

Prática: Hoje, quando sentir ansiedade surgindo, faça uma pausa para respirar e apresente a situação a Deus em oração, agradecendo antecipadamente por Sua intervenção.`;

// Função para inicializar a conversa
async function iniciarConversa() {
  console.log('=== TESTE DO SISTEMA DE CONVERSAS ===\n');
  console.log('Simulando uma conversa individualizada com o bot\n');
  
  // Registrar o devocional de exemplo
  await conversasHandler.registrarDevocionalEnviado(TELEFONE_TESTE, devocionalExemplo);
  
  console.log('Devocional enviado hoje:');
  console.log(devocionalExemplo);
  console.log('\n-------------------------------------------\n');
  console.log('Digite suas mensagens como se fosse um usuário respondendo ao devocional.');
  console.log('Digite "sair" para encerrar o teste.\n');
  
  perguntarUsuario();
}

// Função para processar a entrada do usuário
function perguntarUsuario() {
  rl.question('Você: ', async (mensagem) => {
    if (mensagem.toLowerCase() === 'sair') {
      console.log('\nEncerrando teste...');
      rl.close();
      return;
    }
    
    console.log('\nProcessando mensagem...');
    
    try {
      // Gerar resposta do bot
      const resposta = await conversasHandler.gerarRespostaParaMensagem(TELEFONE_TESTE, mensagem);
      
      console.log(`\nBot: ${resposta}\n`);
    } catch (erro) {
      console.error('Erro ao gerar resposta:', erro.message);
    }
    
    // Continuar a conversa
    perguntarUsuario();
  });
}

// Iniciar o teste
iniciarConversa();