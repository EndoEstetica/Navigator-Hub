# Raport z Audytu Systemu Navigator-Hubb

Zgodnie z poleceniem, przeprowadziłem szczegółowy audyt kodu (backend `server.js`, frontend `app.js` / `index.html` oraz struktury bazy danych Supabase). Poniżej znajduje się podsumowanie obecnego stanu systemu w odniesieniu do wymagań zdefiniowanych w dokumencie `Pasted_content_06.txt`.

## 1. Co działa poprawnie

* **Pobieranie danych z GHL:** System poprawnie łączy się z API GHL i pobiera kontakty, notatki (custom fields) oraz aktywności (`activities`).
* **Karta pacjenta (częściowo):** Zaimplementowano podstawowy widok karty pacjenta, który pobiera i wyświetla `customFields` (m.in. "Z czym się zgłasza", "Zgoda marketingowa", "Data W0"). Widok ten posiada już dwie zakładki: "Aktywność GHL" (gdzie wyświetlane są pobrane `activities`) oraz "Historia połączeń" (pobierana z Supabase).
* **Nagrania (Zadarma):** Webhook `NOTIFY_RECORD` działa poprawnie. Otrzymany `recording_url` jest zapisywany w bazie danych w tabeli `calls` (funkcja `storeCall` robi częściowy update, nie nadpisując innych danych). Działa również mechanizm kolejki ponownych prób (`recordingRetryQueue`) dla połączeń, które zakończyły się, ale nie otrzymały od razu nagrania. Nagrania są widoczne w interfejsie (możliwość odtworzenia/pobrania).
* **Zadania (Tasks):** Tabela `tasks` istnieje. Zadania są automatycznie tworzone m.in. w przypadku odwołania wizyty bez podania nowego terminu (`task_type: 'follow_up_call'`).
* **Podstawowa tabela events:** Została utworzona w ramach wcześniejszych migracji (zawiera kolumny: `id`, `event_type`, `contact_id`, `contact_name`, `user_id`, `description`, `metadata`, `created_at`). Dodawane są do niej niektóre zdarzenia z aplikacji (np. `first_call`, `visit_cancelled`, `follow_up_created`).

## 2. Co istnieje, ale nie działa lub wymaga poprawy

* **Zapis notatek i aktywności z GHL do bazy:** Aktywności (`activities`) i notatki z GHL są pobierane *w locie* przy otwieraniu karty pacjenta (w endpoint `GET /api/contact/:id/card`), ale **nie są trwale zapisywane** w naszej bazie danych w tabeli `events`. Służą jedynie do jednorazowego wyświetlenia.
* **Logika pierwszej rozmowy (`first_call`):** W kodzie istnieje zalążek logiki dodający event `first_call` (gdy `contactType === 'NOWY_PACJENT'`), ale brakuje pełnej spójności – definicja "rozmowa odebrana + oznaczono nowy pacjent" nie jest rygorystycznie egzekwowana we wszystkich miejscach, a frontend nie pokazuje najwcześniejszego `first_call` na karcie pacjenta w sposób wymagany w specyfikacji.
* **Karta pacjenta – puste sekcje:** Obecny kod HTML i JS wyświetla puste sekcje (np. z kreseczką `—`), jeśli pole nie ma wartości. Zgodnie z nowymi wymaganiami, sekcje bez danych powinny być całkowicie ukrywane.
* **Statusy (contact_status vs pipeline_stage):** W kodzie istnieje słownik `GHL_STAGES` (etapy lejka w GHL), ale brakuje wyraźnego, trwałego rozdzielenia i widoczności operacyjnego statusu kontaktu (`contact_status`) na poziomie samej encji pacjenta. W bazie `contacts` dodano niedawno pole `last_call_status`, ale nie jest to w pełni zintegrowany, niezależny "status operacyjny".

## 3. Czego brakuje

* **Pełnego modelu historii (Timeline):** Choć na karcie pacjenta są zakładki "Aktywność GHL" i "Historia połączeń", brakuje jednego, spójnego widoku Timeline, który łączyłby *wszystkie* zdarzenia chronologicznie (połączenia z aplikacji, notatki z GHL, notatki z aplikacji, zdarzenia systemowe jak umówienie W0). Wymaga to ujednolicenia źródła danych do tabeli `events`.
* **Rozbudowy tabeli `events`:** Obecny schemat `events` nie posiada kolumny `source` (app/ghl), która jest wymagana do rozróżnienia pochodzenia zdarzenia.
* **Globalnej logiki W0 na poziomie kontaktu:** Pola W0 (`w0_scheduled`, `w0_date`, `w0_doctor`) zostały dodane do tabeli `contacts`, ale logika aplikacji nadal w wielu miejscach próbuje "wyciągać" W0 z ostatniego połączenia (`calls`), zamiast traktować to jako globalną właściwość kontaktu, którą każde połączenie może zaktualizować.
* **Wzbogaconego Popup'u połączenia:** Obecny popup wyświetla jedynie imię, telefon, awatar, czas reakcji oraz (czasem) pole "Z czym się zgłasza". **Całkowicie brakuje** wyświetlania: etapu lejka GHL, statusu operacyjnego kontaktu, informacji czy odbyła się już pierwsza rozmowa, czy jest umówione W0 oraz treści ostatniej notatki.
* **Zaawansowanych statystyk:** Brakuje dokładnego wyliczania konwersji (lead → W0) oraz średnich czasów przejść między etapami (od zgłoszenia do kontaktu, od kontaktu do W0, od W0 do wizyty).
* **Filtrowania:** Brakuje filtrowania połączeń po dacie (wyszukiwanie po nazwisku pacjenta częściowo istnieje w UI, ale wymaga dopracowania na poziomie API/widoku).

## 4. Co wymaga decyzji biznesowej

1. **Synchronizacja dwukierunkowa:** Jeśli zapiszemy aktywności i notatki z GHL do naszej tabeli `events`, jak często powinniśmy je synchronizować? Czy robimy to tylko przy pobieraniu leada, czy potrzebujemy cyklicznego zadania (cron) / webhooka z GHL do aktualizacji `events`? (Obecnie GHL nie wysyła webhooków o *każdej* aktywności, więc może być konieczne dociąganie ich przy otwarciu karty).
2. **Kategoryzacja starych danych:** W bazie istnieje wiele starych połączeń. Jak potraktować je w nowym widoku Timeline? Czy generujemy dla nich wstecznie wpisy w `events`, czy Timeline będzie opierał się na locie łączonych danych (events + calls + GHL activities)? Zalecam migrację starych notatek/połączeń do tabeli `events` dla pełnej spójności.

---

**Kolejne kroki (Etapy 3-6):**
Przystępuję do aktualizacji schematu bazy danych (dodanie kolumny `source` do `events`), refaktoryzacji backendu (zapis z GHL do `events`, globalne W0) oraz przebudowy frontendu (nowy Timeline, wzbogacony popup, ukrywanie pustych pól na karcie pacjenta).
