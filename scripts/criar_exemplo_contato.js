// Script para criar um arquivo de exemplo de contatos

const fs = require('fs-extra');
const path = require('path');
const xlsx = require('xlsx');

// Diretório e arquivo
const CONTATOS_DIR = '../Contatos';
const ARQUIVO_EXEMPLO = path.join(CONTATOS_DIR, 'contatos_exemplo.xlsx');

// Garantir que o diretório exista
if (!fs.existsSync(CONTATOS_DIR)) {
  fs.mkdirSync(CONTATOS_DIR, { recursive: true });
  console.log(`Diretório criado: ${CONTATOS_DIR}`);
}

// Dados de exemplo
const contatos = [
  { 
    Nome: 'João Silva', 
    Telefone: '5511987654321', 
    Ativo: 'Sim',
    Observacoes: 'Contato principal'
  },
  { 
    Nome: 'Maria Oliveira', 
    Telefone: '5521998765432', 
    Ativo: 'Sim',
    Observacoes: 'Contato secundário'
  },
  { 
    Nome: 'Pedro Santos', 
    Telefone: '5531987654321', 
    Ativo: 'Não',
    Observacoes: 'Desativado temporariamente'
  },
  { 
    Nome: 'Ana Costa', 
    Telefone: '5541999887766', 
    Ativo: 'Sim',
    Observacoes: 'Novo contato'
  },
  { 
    Nome: 'Carlos Pereira', 
    Telefone: '5551988776655', 
    Ativo: 'Sim',
    Observacoes: ''
  }
];

// Criar workbook e adicionar dados
const workbook = xlsx.utils.book_new();
const worksheet = xlsx.utils.json_to_sheet(contatos);

// Adicionar a planilha ao workbook
xlsx.utils.book_append_sheet(workbook, worksheet, 'Contatos');

// Salvar o arquivo
xlsx.writeFile(workbook, ARQUIVO_EXEMPLO);

console.log(`Arquivo de exemplo criado: ${ARQUIVO_EXEMPLO}`);
console.log('Modelo de contatos:');
console.table(contatos);