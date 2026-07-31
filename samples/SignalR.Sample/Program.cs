using Microsoft.AspNetCore.SignalR;
using System.Runtime.CompilerServices;

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

    public async IAsyncEnumerable<int> StreamCounter(
        int count,
        int delayMilliseconds,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var boundedCount = Math.Clamp(count, 1, 10);
        var boundedDelay = Math.Clamp(delayMilliseconds, 0, 1_000);

        for (var value = 1; value <= boundedCount; value++)
        {
            await Task.Delay(boundedDelay, cancellationToken);
            yield return value;
        }
    }
}
