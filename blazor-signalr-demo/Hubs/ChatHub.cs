using Microsoft.AspNetCore.SignalR;

namespace blazor_signalr_demo.Hubs;

public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        var safeUser = string.IsNullOrWhiteSpace(user) ? "Anon" : user.Trim();
        var safeMessage = string.IsNullOrWhiteSpace(message) ? string.Empty : message.Trim();

        if (string.IsNullOrEmpty(safeMessage))
        {
            return;
        }

        var timestamp = DateTimeOffset.UtcNow.ToString("O");
        await Clients.All.SendAsync("ReceiveMessage", safeUser, safeMessage, timestamp);
    }
}
