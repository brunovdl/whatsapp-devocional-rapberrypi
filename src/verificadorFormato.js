// Módulo para verificar e corrigir o formato do devocional (Otimizado)

const { logger } = require('./utils');

// Verificar se o devocional segue o formato esperado
function verificarFormatoDevocional(devocional) {
  try {
    if (!devocional) {
      return { valido: false, mensagem: 'Devocional vazio ou nulo' };
    }
    
    // Verificar elementos essenciais
    const temData = devocional.includes('📅') || /\d+ de [a-zç]+ de \d+/i.test(devocional);
    const temVersiculo = devocional.includes('*Versículo:*') || devocional.includes('Versículo:');
    const temReflexao = devocional.includes('*Reflexão:*') || devocional.includes('Reflexão:');
    const temPratica = devocional.includes('*Prática:*') || devocional.includes('Prática:');
    
    // Verificar a presença de referência bíblica entre parênteses
    const temReferenciaBiblica = /\([A-Za-záàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ]+ \d+:\d+(?:-\d+)?\)/i.test(devocional);
    
    // Verificar a presença de texto entre aspas (versículo)
    const temTextoEntreAspas = /\"[^\"]+\"/i.test(devocional);
    
    // Log detalhado para debug
    logger.debug(`Verificação de formato: data=${temData}, versículo=${temVersiculo}, reflexão=${temReflexao}, prática=${temPratica}, referência=${temReferenciaBiblica}, aspas=${temTextoEntreAspas}`);
    
    // Todos os elementos devem estar presentes
    const valido = temData && temVersiculo && temReflexao && temPratica && temReferenciaBiblica && temTextoEntreAspas;
    
    // Se não for válido, criar uma mensagem de erro detalhada
    let mensagem = 'Formato válido';
    if (!valido) {
      mensagem = 'Devocional com formato inválido:';
      if (!temData) mensagem += ' Falta data;';
      if (!temVersiculo) mensagem += ' Falta marcador de versículo;';
      if (!temReflexao) mensagem += ' Falta marcador de reflexão;';
      if (!temPratica) mensagem += ' Falta marcador de prática;';
      if (!temReferenciaBiblica) mensagem += ' Falta referência bíblica entre parênteses;';
      if (!temTextoEntreAspas) mensagem += ' Falta texto do versículo entre aspas;';
    }
    
    return { valido, mensagem };
  } catch (erro) {
    logger.error(`Erro ao verificar formato do devocional: ${erro.message}`);
    return { valido: false, mensagem: `Erro: ${erro.message}` };
  }
}

// Corrigir o formato do devocional se possível
function corrigirFormatoDevocional(devocional) {
  try {
    if (!devocional) return null;
    
    // Já está no formato correto? Não faça nada
    const { valido } = verificarFormatoDevocional(devocional);
    if (valido) return devocional;
    
    // Extrair partes do devocional
    const linhas = devocional.split('\n').filter(linha => linha.trim());
    let devocionalCorrigido = '';
    
    // Tentar identificar as seções
    let dataLinha = '';
    let versiculoLinha = '';
    let reflexaoLinha = '';
    let praticaLinha = '';
    
    // Procurar por cada seção
    for (const linha of linhas) {
      const linhaMinuscula = linha.toLowerCase();
      
      if (linhaMinuscula.includes('de abril de') || linhaMinuscula.includes('de maio de') || 
          /\d+ de [a-zç]+ de \d+/i.test(linha)) {
        dataLinha = linha;
      } else if (linhaMinuscula.includes('versículo') || linhaMinuscula.includes('versiculo')) {
        versiculoLinha = linha;
      } else if (linhaMinuscula.includes('reflexão') || linhaMinuscula.includes('reflexao')) {
        reflexaoLinha = linha;
      } else if (linhaMinuscula.includes('prática') || linhaMinuscula.includes('pratica')) {
        praticaLinha = linha;
      }
    }
    
    // Formatar a data se encontrada
    if (dataLinha) {
      if (!dataLinha.includes('📅')) {
        devocionalCorrigido += '📅 ' + dataLinha.replace(/^\s*📅\s*/, '').trim() + '\n\n';
      } else {
        devocionalCorrigido += dataLinha.trim() + '\n\n';
      }
    }
    
    // Formatar o versículo se encontrado
    if (versiculoLinha) {
      if (!versiculoLinha.includes('*Versículo:*')) {
        const formatado = versiculoLinha
          .replace(/^\s*📖\s*/, '')
          .replace(/versículo:|\\*versículo\\*:|versículo|versiculo/i, '*Versículo:*')
          .trim();
        devocionalCorrigido += '📖 ' + formatado + '\n\n';
      } else {
        devocionalCorrigido += '📖 ' + versiculoLinha.replace(/^\s*📖\s*/, '').trim() + '\n\n';
      }
    }
    
    // Formatar a reflexão se encontrada
    if (reflexaoLinha) {
      if (!reflexaoLinha.includes('*Reflexão:*')) {
        const formatado = reflexaoLinha
          .replace(/^\s*💭\s*/, '')
          .replace(/reflexão:|\\*reflexão\\*:|reflexão|reflexao/i, '*Reflexão:*')
          .trim();
        devocionalCorrigido += '💭 ' + formatado + '\n\n';
      } else {
        devocionalCorrigido += '💭 ' + reflexaoLinha.replace(/^\s*💭\s*/, '').trim() + '\n\n';
      }
    }
    
    // Formatar a prática se encontrada
    if (praticaLinha) {
      if (!praticaLinha.includes('*Prática:*')) {
        const formatado = praticaLinha
          .replace(/^\s*🧗🏼\s*/, '')
          .replace(/prática:|\\*prática\\*:|prática|pratica/i, '*Prática:*')
          .trim();
        devocionalCorrigido += '🧗🏼 ' + formatado;
      } else {
        devocionalCorrigido += '🧗🏼 ' + praticaLinha.replace(/^\s*🧗🏼\s*/, '').trim();
      }
    }
    
    // Se conseguiu corrigir o formato, retorne o devocional corrigido
    if (devocionalCorrigido.trim()) {
      logger.debug('Formato do devocional corrigido com sucesso');
      return devocionalCorrigido;
    } else {
      logger.warn('Não foi possível corrigir o formato do devocional');
      return devocional; // Retorna o original se não conseguir corrigir
    }
  } catch (erro) {
    logger.error(`Erro ao corrigir formato do devocional: ${erro.message}`);
    return devocional; // Retorna o original em caso de erro
  }
}

module.exports = {
  verificarFormatoDevocional,
  corrigirFormatoDevocional
};