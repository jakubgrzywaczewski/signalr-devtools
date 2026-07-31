using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR().AddMessagePackProtocol();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapHub<ChatHub>("/chatHub");
app.Run();

public sealed class ChatHub : Hub
{
    public Task SendMessage(string user, string message) =>
        Clients.All.SendAsync("ReceiveMessage", user, message);
}
