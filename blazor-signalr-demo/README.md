# Blazor SignalR Demo

Prosta aplikacja Blazor Web App demonstrująca ruch SignalR na endpointzie `/grpc/chat`, przeznaczona do testowania rozszerzenia SignalR Inspector.

## Funkcje

- Serwerowy hub `ChatHub` nasłuchujący pod `/grpc/chat`.
- Komponent `Home` z real-time czatem korzystającym z klienta JavaScript (`@microsoft/signalr`).
- Możliwość wysyłania i odbierania wiadomości w przeglądarce, co generuje ruch WebSocket z charakterystycznym `/grpc` w URL.

## Uruchomienie

```bash
cd /Users/enkidu/exten/blazor-signalr-demo
DOTNET_ENVIRONMENT=Development dotnet run
```

Aplikacja startuje domyślnie pod `https://localhost:7140` (patrz `Properties/launchSettings.json`). Po wejściu na stronę główną otwórz DevTools i kartę „SignalR Inspector”, aby obserwować komunikaty.

## Struktura

- `Hubs/ChatHub.cs` – implementacja huba.
- `Components/Pages/Home.razor` – interfejs użytkownika z JS interop.
- `wwwroot/js/chatClient.js` – klient JS oparty na `@microsoft/signalr`.

## Testowanie rozszerzenia

1. Odpal aplikację (`dotnet run`).
2. Załaduj rozszerzenie SignalR Inspector w Chrome (tryb deweloperski).
3. W przeglądarce otwórz stronę demo, wpisz wiadomość i obserwuj panel rozszerzenia – kolejne komunikaty IN/OUT powinny się pojawiać.
