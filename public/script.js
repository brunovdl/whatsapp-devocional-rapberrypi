document.addEventListener('DOMContentLoaded', () => {
    // Função para carregar as configurações existentes
    function loadConfigurations() {
        fetch('/config')
            .then(response => response.json())
            .then(config => {
                // Preencher os campos do formulário com os dados retornados
                // Adapte isso para os campos reais do seu formulário
                document.getElementById('campo1').value = config.campo1 || '';
                document.getElementById('campo2').value = config.campo2 || '';
                // ... adicione mais campos conforme necessário
            })
            .catch(error => {
                console.error('Erro ao carregar configurações:', error);
            });

        // Carregar e exibir o QR Code
        fetch('/qrcode')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Erro ao carregar o QR Code');
                }
                return response.json(); // Assumindo que a resposta é um JSON com a URL ou base64
            })
            .then(data => {
                const qrcodeDiv = document.getElementById('qrcode');
                qrcodeDiv.innerHTML = `<img src="${data.qrcode}" alt="QR Code para conectar o WhatsApp">`; // Assumindo que a resposta tem uma propriedade 'qrcode'
            })
            .catch(error => {
                console.error('Erro ao carregar o QR Code:', error);
            });
    }

    // Carregar configurações ao carregar a página
    loadConfigurations();

    // Adicionar event listener ao botão de salvar
    const saveButton = document.getElementById('saveConfig');
    saveButton.addEventListener('click', () => {
        // Coletar dados do formulário
        const configData = {
            campo1: document.getElementById('campo1').value,
            campo2: document.getElementById('campo2').value,
            // ... colete mais campos conforme necessário
        };

        // Logar os dados no console por enquanto
        console.log('Configurações a serem salvas:', configData);
    });
});
