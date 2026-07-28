using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Protocol;

var outputPath = Path.GetFullPath(
    args.FirstOrDefault() ?? "signalr-inspector/tests/fixtures/signalr-messagepack.json"
);
var protocol = new MessagePackHubProtocol();
var fixtures = new List<Fixture>();

Add(
    "invocation",
    new InvocationMessage(
        "42",
        "Send",
        [
            "Ada",
            42,
            long.MaxValue,
            new byte[] { 0xde, 0xad, 0xbe, 0xef },
            new Dictionary<string, object?> { ["active"] = true, ["score"] = 1.5 },
        ],
        []
    ),
    new
    {
        type = 1,
        invocationId = "42",
        target = "Send",
        arguments = new object?[]
        {
            "Ada",
            42,
            long.MaxValue.ToString(),
            new { type = "binary", length = 4, preview = "de ad be ef" },
            new { active = true, score = 1.5 },
        },
        streamIds = Array.Empty<string>(),
    }
);
Add(
    "stream-item",
    new StreamItemMessage("42", new Dictionary<string, object?> { ["value"] = 7 }),
    new { type = 2, invocationId = "42", item = new { value = 7 } }
);
Add(
    "completion-error",
    CompletionMessage.WithError("42", "failed"),
    new { type = 3, invocationId = "42", error = "failed" }
);
Add(
    "completion-void",
    CompletionMessage.Empty("43"),
    new { type = 3, invocationId = "43" }
);
Add(
    "completion-result",
    CompletionMessage.WithResult("44", 42),
    new { type = 3, invocationId = "44", result = 42 }
);
Add(
    "stream-invocation",
    new StreamInvocationMessage("45", "Counter", [3], []),
    new
    {
        type = 4,
        invocationId = "45",
        target = "Counter",
        arguments = new[] { 3 },
        streamIds = Array.Empty<string>(),
    }
);
Add(
    "cancel-invocation",
    new CancelInvocationMessage("45"),
    new { type = 5, invocationId = "45" }
);
Add("ping", PingMessage.Instance, new { type = 6 });
Add(
    "close",
    new CloseMessage("maintenance", allowReconnect: true),
    new { type = 7, error = "maintenance", allowReconnect = true }
);
Add("ack", new AckMessage(1394), new { type = 8, sequenceId = 1394 });
Add("sequence", new SequenceMessage(1234), new { type = 9, sequenceId = 1234 });

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
File.WriteAllText(
    outputPath,
    JsonSerializer.Serialize(
        fixtures,
        new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        }
    ) + Environment.NewLine
);
Console.WriteLine($"Generated {fixtures.Count} official SignalR MessagePack fixtures at {outputPath}.");

void Add(string name, HubMessage message, object expected)
{
    fixtures.Add(
        new Fixture(name, Convert.ToBase64String(protocol.GetMessageBytes(message).Span), expected)
    );
}

internal sealed record Fixture(string Name, string Base64, object Expected);
