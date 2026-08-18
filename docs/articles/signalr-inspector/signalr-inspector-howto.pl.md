# Jak debugować ruch SignalR w Chrome i Edge z SignalR Inspector

![SignalR Inspector — zrozum ruch huba, nie surowe ramki](images/signalr-inspector-cover.png)

To praktyczny materiał towarzyszący esejowi *SignalR to nie tylko ramka WebSocket*: esej wyjaśnia,
dlaczego narzędzie ma taką architekturę, a ten poradnik pokazuje, jak go używać.

Chrome DevTools pokazuje coś takiego:

```text
{"type":1,"invocationId":"42","target":"SendMessage","arguments":["Ada","Hello"]}\u001e
```

I Twój mózg musi to dekodować: `type: 1` to invocation, `target` to metoda huba,
`invocationId` łączy wywołanie z completion, które jest gdzieś niżej — być może w innej ramce
transportu i wymieszane z pingami. Za każdym razem od nowa.

SignalR Inspector to darmowy panel DevTools (licencja MIT) dla Chrome i Edge, który dekoduje
ruch ASP.NET Core SignalR — JSON i MessagePack po WebSockets, Server-Sent Events i Long Pollingu —
i zamiast surowych ramek pokazuje konwersację: wywołania sparowane z odpowiedziami, pogrupowane streamy
i historię życia każdego połączenia na osi czasu. Nic nie opuszcza przeglądarki: zero
telemetrii, zero uprawnień do hostów, aktywacja per-tab.

Ten wpis to przegląd scenariuszy debugowania na przykładzie aplikacji demo z repozytorium.

## Instalacja

- [Chrome Web Store](https://chromewebstore.google.com/detail/signalr-inspector/lgaffhilcepfgfiealbdadfedpdfnfla)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/signalr-inspector/hlohgfgkniolajoidmnmahelkejeimnh)
- Ze źródeł: sklonuj [repozytorium](https://github.com/jakubgrzywaczewski/signalr-devtools),
  a potem załaduj katalog `signalr-inspector/` jako unpacked extension
  (`chrome://extensions` → tryb dewelopera → *Load unpacked*).

Żeby przetestować bez własnej aplikacji, uruchom dołączony sample w .NET 10 — bez npm install;
jedyna zależność NuGet (protokół MessagePack) restauruje się automatycznie:

```bash
dotnet run --project samples/SignalR.Sample
```

i otwórz `http://localhost:5141`. Strona ma cztery przyciski scenariuszy: **WebSockets
(JSON)**, **Long Polling (JSON)**, **Server-Sent Events (JSON)** i **MessagePack
(WebSockets)**.

## Krok 1: aktywuj kartę, otwórz panel

Instrumentacja strony pozostaje wyłączona, dopóki jej nie uruchomisz. Kliknij ikonę rozszerzenia
na pasku narzędzi na karcie, którą chcesz obserwować: ikona dostaje badge aktywności, a karta
przeładowuje się, żeby handshake SignalR został przechwycony od pierwszej ramki. Ponowne kliknięcie wyłącza
instrumentację i przeładowuje stronę na czysto — aktywacja to przełącznik per-tab.

Potem otwórz DevTools (`F12`) i wybierz zakładkę **SignalR Inspector**. Do dyspozycji są trzy
widoki: **Messages**, **Timeline** i **Insights**.

![SignalR Inspector pokazujący zdekodowany ruch huba](images/signalr-inspector-live.png)

Nie musisz zgadywać, czy przechwytywanie działa: panel pokazuje wskaźnik stanu
(`Capturing · last at …` / `Not capturing`), a dopóki karta nie jest aktywowana — banner onboardingowy
wskazujący ikonę na pasku narzędzi. Jeśli spływa wyłącznie ruch obserwowany przez DevTools
(Long Polling, wychodzące POST-y SSE) bez aktywacji karty, wskaźnik mówi to wprost.

Jedna zasada pracy warta zapamiętania: **otwieraj DevTools zanim połączenie wystartuje**, jeśli
zależy Ci na Long Pollingu albo wychodzącej połowie Server-Sent Events. Te transporty są
obserwowane przez read-only API sieciowe DevTools, które nie widzi żądań zakończonych zanim
panel istniał. Ruch WebSocket i przychodzące SSE są przechwytywane na poziomie strony, więc tego
ograniczenia nie mają — ale nawyk „aktywuj, otwórz DevTools, dopiero łącz” działa zawsze.

## „Które wywołanie padło i ile trwało?”

Uruchom scenariusz WebSockets (JSON) i wyślij kilka wiadomości. W widoku **Messages** każdy
wiersz invocation ma etykietę Flow w rodzaju `Completed · 240 ms` albo `Error · 1.3 s` — panel
paruje wywołania z ich completion po połączeniu, kierunku i invocation ID, więc odpowiedź jest
w tej samej linii, a nie trzysta wierszy dalej.

Zaznacz wiersz, żeby otworzyć szczegóły: sparsowane argumenty, target, transport i przycisk
**Go to Completion #N**, który przeskakuje wprost do sparowanej odpowiedzi (i z powrotem). Przy
błędach tekst błędu z completion jest widoczny obok wywołania, które go spowodowało.

## „Co to za szum?” — filtry

Pasek filtrów się składa:

- wyszukiwanie tekstowe po endpoincie i payloadzie,
- kierunek (incoming / outgoing),
- typ wiadomości SignalR (Invocation, Completion, Stream item, …),
- transport (WebSocket, Server-Sent Events, Long Polling, negotiation).

Protokołowe pingi keep-alive są domyślnie ukryte — zaznacz *Show pings*, kiedy naprawdę ich
potrzebujesz. Typowy triage: filtr `Invocation` + outgoing, żeby zobaczyć, co wysłała aplikacja,
potem `Completion` + incoming, żeby zobaczyć, co wróciło.

![Filtrowanie stream invocation po typie wiadomości](images/signalr-inspector-filtering.png)

## „Czy mój stream jest zdrowy?”

Scenariusz `StreamCounter` w sample'u generuje prawdziwy `StreamInvocation` z ruchem
`StreamItem`. Panel grupuje itemy pod ich wywołaniem jako zwijana grupa z licznikiem i
zaobserwowanym tempem doręczania — zawieszony albo wolny stream widać od razu, zamiast
przewijać niekończącą się listę wierszy.

## „Czemu połączenie padło o 14:32?” — Timeline

Przełącz się na **Timeline**, żeby zobaczyć historię życia połączenia: negotiate → otwarcie
transportu → handshake → keep-alive → reconnect → close, z powodami zamknięcia i jawnym
fallbackiem transportu. Pingi keep-alive są agregowane per połączenie do licznika i mediany
odstępu — widzisz anomalię, a nie dwieście wierszy rutynowego pulsu. Sample ma przycisk
kontrolowanego zerwania transportu właśnie po to, żeby obejrzeć reconnect w akcji.

Jeśli aplikacja używa stateful reconnect z .NET 8+, wiadomości acknowledgement i sequence są
wizualizowane osobno dla każdego kierunku — a wznowiony transport jest scalany z przerwanym
połączeniem: zostaje jedna karta, parowanie invocations i grupy streamów przeżywają zerwanie,
zamiast lądować na zdublowanej karcie.

![Cykl życia połączenia i kontrolowany reconnect w Timeline](images/signalr-inspector-timeline.png)

## MessagePack też działa

Uruchom scenariusz MessagePack (WebSockets). Binarne ramki są dekodowane jak JSON-owe — typy
wiadomości huba, targety, argumenty, 64-bitowe liczby bez cichej utraty precyzji — a uszkodzone
ramki spadają do surowego widoku Base64/hex. Dekoder jest testowany na golden fixtures
wygenerowanych oficjalną implementacją ASP.NET Core SignalR.

## „U mnie działało” — eksport sesji

**Export session** zapisuje bieżący log do wersjonowanego pliku JSON; **Import session** go
przywraca — innego dnia albo w przeglądarce kogoś z zespołu, gdzie Flow, Timeline i Insights
działają na zaimportowanych danych. Pomyśl: plik HAR, tylko dla konwersacji SignalR. Eksport
jest ograniczony rozmiarowo i sanityzowany (tokeny połączeń i identyfikatory rozszerzenia nie
trafiają do pliku), ale przechwycone payloady aplikacji są zachowywane — o to chodzi — więc
traktuj plik jak każdy artefakt debugowania.

## Insights: statystyki i ostrzeżenia

Widok **Insights** wyprowadza — lokalnie — z tego samego przechwyconego logu: tempo wiadomości
i bajtów, wolumen, rozkład wywołań per metoda huba oraz liczbę połączeń przez Azure SignalR
(standardowe redirecty negocjacji dostają badge; tokeny dostępu są odrzucane). Ostrzeżenia
odpalają się w czterech konserwatywnych, protokołowo zakotwiczonych sytuacjach: wychodzący
payload blisko domyślnego limitu 32 KiB ASP.NET Core, invocation wciąż bez completion po
30 sekundach dalszego ruchu, stream ucięty zamknięciem połączenia (raportowany jako invocation
bez completion) i odstępy keep-alive odstające od rytmu, który samo połączenie zademonstrowało
(z progiem zapasowym 30 sekund, zanim rytm istnieje).

![Lokalne statystyki ruchu i ostrzeżenia protokołowe w Insights](images/signalr-inspector-insights.png)

## Czego celowo nie robi

- Nie wstrzykuje wiadomości ani nie symuluje rozłączeń — narzędzie jest read-only z założenia.
- Nie przechwytuje na poziomie strony ruchu WebSocket ani przychodzącego SSE z iframe'ów i Web
  Workerów; ruch HTTP może nadal być widoczny dla obserwatora sieci DevTools.
- Long Polling i wychodzące SSE wymagają DevTools otwartych przed negocjacją (ograniczenie API
  przeglądarki).
- Niestandardowe domeny przed Azure SignalR Service nie są rozpoznawane.
- Zero telemetrii, persystencji i sieci wychodzącej: przechwycone dane żyją w pamięci (limit
  500 wiadomości per karta), umierają z kartą i opuszczają przeglądarkę wyłącznie przez jawny
  eksport.

## Linki

- Źródła, sample i wydania:
  [github.com/jakubgrzywaczewski/signalr-devtools](https://github.com/jakubgrzywaczewski/signalr-devtools)

Feedback jest szczerze mile widziany — zwłaszcza informacja, czego brakuje w Twoim workflow
debugowania.
