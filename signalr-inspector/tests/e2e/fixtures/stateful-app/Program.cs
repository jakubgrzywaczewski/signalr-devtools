using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapHub<StatefulChatHub>("/chatHub", options => options.AllowStatefulReconnects = true);
app.Run();

public sealed class StatefulChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async IAsyncEnumerable<int> StreamCounter(
        int count,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        for (var i = 1; i <= count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return i;
            await Task.Delay(300, cancellationToken);
        }
    }
}
