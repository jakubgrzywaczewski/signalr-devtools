# Raport audytu artykułów i grafik SignalR Inspector

Data audytu: 18 sierpnia 2026
Punkt odniesienia: zachowanie kodu do 1.0.2, publiczne wydanie sklepowe 1.0.0; ten pakiet
dokumentacyjny otrzymuje wersję 1.0.3

## Werdykt

Materiały nadal mają sens publikacyjny i są merytorycznie mocne. Najlepiej publikować je jako dwa
osobne teksty, nie jeden połączony materiał:

- esej architektoniczny jako długi, ekspercki deep dive;
- poradnik jako krótki, praktyczny companion prowadzący od instalacji do diagnozy.

Esej angielski ma około 5570 słów, więc nie jest lekkim wprowadzeniem. Jego długość jest
uzasadniona spójną historią: od błędnej heurystyki URL, przez granice zaufania i transporty, po
korelację, eksport, Insights i testy E2E. Warto oznaczyć go jako deep dive i nie łączyć z
poradnikiem. Poradnik ma około 1250 słów i nadaje się do publikacji bez skracania.

## Co zostało poprawione

- Doprecyzowano, że tekst dotyczy ASP.NET Core SignalR i Hub Protocol, a nie starszego ASP.NET
  SignalR.
- Uściślono framing MessagePack: binarny payload może zawierać sekwencję wiadomości, z których
  każda ma prefiks długości VarInt; nie należy utożsamiać wiadomości protokołu z pojedynczą ramką
  transportu.
- Zawężono ograniczenie iframe/Web Worker do przechwytywania WebSocket i przychodzącego SSE na
  poziomie strony. Ruch HTTP nadal może być widoczny dla obserwatora sieci DevTools.
- Usunięto nieścisłe przedstawienie limitów liczonych przez implementację w znakach jako literalne
  MiB pliku.
- Poprawiono opis aktywacji: instrumentacja strony jest wyłączona do kliknięcia ikony, ale pasywny
  obserwator sieci może działać po otwarciu panelu także bez aktywacji karty.
- Ujednolicono widoczny zapis separatora rekordów jako `\u001e`.
- Poprawiono polską interpunkcję, cudzysłowy i kilka niezgrabnych sformułowań.
- Dodano istniejącą, zgodną z brandingiem grafikę 1400×560 jako okładkę wszystkich wersji.
- Finalne kopie nie zawierają wewnętrznych komentarzy wydawniczych i używają lokalnych ścieżek do
  kompletu grafik.

## Audyt merytoryczny

Twierdzenia o handshake'u, typach wiadomości 1–9, JSON/MessagePack, Long Pollingu, SSE, stateful
reconnect, limicie 500 wpisów, limicie payloadu 256 KiB, eksporcie/imporcie, ostrzeżeniach
Insights, uprawnieniach `activeTab`/`scripting` i braku host permissions zostały porównane z kodem,
testami i README projektu.

Sprawdzono też aktualne źródła pierwotne: specyfikacje ASP.NET Core SignalR, dokumentację Chrome
Extensions i DevTools Network, dokumentację Firefox WebSocket Inspector, dokumentację Azure
SignalR oraz strony obu porównywanych rozszerzeń. Wszystkie publiczne URL-e z artykułów zwracały
HTTP 200 w dniu audytu.

Pakiet dokumentacyjny ma wersję 1.0.3, a sklepy publicznie pokazują 1.0.0. Nie unieważnia to
tekstów: zmiany 1.0.1–1.0.3 dotyczą dokumentacji i materiałów demonstracyjnych, a artykuły
świadomie opisują stabilną serię 1.0.

## Audyt grafik

- Okładka: 1400×560, poprawny kontrast, krótki komunikat i dużo bezpiecznej przestrzeni.
- Cztery screenshoty: 1280×800, zgodne z aktualnym panelem, czytelne i bez danych wrażliwych.
- GIF rozmowy: 1280×800, pokazuje parowanie invocation/completion, grupowanie streamu i Timeline.
- GIF eksportu: 1280×800, pokazuje pełny round trip export → clear → import.
- Dane na wszystkich grafikach są deterministyczne i fikcyjne.

Nie było potrzeby generowania nowych obrazów ani retuszu. Po wgraniu do Medium warto używać
szerokiego trybu prezentacji; przy zwykłej szerokości kolumny tekst w UI będzie mniejszy, choć
nadal czytelny po otwarciu obrazu.

## Ryzyka przed publikacją

1. Publiczny opis w
   [Chrome Web Store](https://chromewebstore.google.com/detail/signalr-inspector/lgaffhilcepfgfiealbdadfedpdfnfla)
   jest częściowo nieaktualny: nadal podaje, że wychodzące POST-y SSE nie są przechwytywane, i w
   sekcji „What's new” opisuje 0.11.1, mimo że sklep pokazuje wersję 1.0.0. Artykuły i aktualny kod
   mówią prawidłowo, że wychodzące SSE jest przechwytywane przez obserwator sieci DevTools. Opis
   sklepu warto zsynchronizować przed promocją tekstów.
2. Po publikacji eseju trzeba podlinkować jego kanoniczny URL we wstępie i sekcji linków obu
   poradników.
3. Medium zwykle wymaga ręcznego uploadu lokalnych grafik z ZIP-a. Należy sprawdzić po publikacji,
   czy GIF-y animują się, a szerokie screenshoty nie zostały wstawione jako małe miniatury.

## Rekomendacja dystrybucji

- Medium: angielski esej architektoniczny jako tekst kanoniczny.
- dev.to lub blog projektu: angielski poradnik z `canonical_url` prowadzącym do wybranego miejsca.
- Blog PL / Dotnetomaniak / LinkedIn PL: polskie adaptacje, nie automatyczne tłumaczenia.
- Odstęp między esejem i poradnikiem: 2–4 dni; drugi tekst powinien linkować do pierwszego.

Pakiet jest gotowy redakcyjnie. Jedynym istotnym zadaniem poza samymi artykułami jest aktualizacja
opisu Chrome Web Store, której ten audyt nie wykonywał.
