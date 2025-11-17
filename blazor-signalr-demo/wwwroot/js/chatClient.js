window.chatClient = (() => {
    let connection;
    let dotNetRef;

    function resolveBase(baseUrl) {
        try {
            return new URL('/grpc/chat', baseUrl).toString();
        } catch (err) {
            console.error('Niepoprawny adres bazowy', err);
            return '/grpc/chat';
        }
    }

    async function init(baseUrl, reference) {
        if (!window.signalR) {
            throw new Error('Biblioteka @microsoft/signalr nie została załadowana');
        }
        dotNetRef = reference;
        const endpoint = resolveBase(baseUrl);

        connection = new signalR.HubConnectionBuilder()
            .withUrl(endpoint)
            .withAutomaticReconnect()
            .build();

        connection.on('ReceiveMessage', (user, message, timestamp) => {
            if (!dotNetRef) {
                return;
            }
            dotNetRef.invokeMethodAsync('OnMessageReceived', user, message, timestamp);
        });

        await connection.start();
    }

    function ensureConnection() {
        if (!connection) {
            throw new Error('Brak aktywnego połączenia SignalR');
        }
    }

    async function send(user, message) {
        ensureConnection();
        return connection.invoke('SendMessage', user, message);
    }

    async function stop() {
        if (!connection) {
            return;
        }
        const current = connection;
        connection = null;
        await current.stop();
    }

    return {
        init,
        send,
        stop,
    };
})();
