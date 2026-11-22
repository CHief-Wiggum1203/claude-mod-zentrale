# mod-zentrale

Ein Claude-Code-Mod: ein Panel **„Mod-Zentrale“**, in dem du alle installierten Mods und Plugins siehst, per Knopf ein- und ausschaltest, aktualisierst und einstellst.

- in der Desktop-App startet sie als kleines **Widget** mit der Übersicht (Mods/Plugins an, verfügbare Updates, Änderungen ab der nächsten Session), ein Klick vergrößert sie
- `/mods` öffnet das Panel und liest die aktuelle Liste
- zuerst die **Mods** (Plugins mit eigenem Hooks-Modul), dann die **weiteren Plugins**
- pro Eintrag: an (●) oder aus (○), Name, Version, Marketplace und Beschreibung
- **Ausschalten** / **Einschalten** schaltet das Plugin in dem Scope um, in dem es installiert ist (user, project oder local), mit kurzer Meldung
- ein umgeschaltetes Plugin ist markiert mit „gilt ab der nächsten Session“: die laufende Session behält, was sie geladen hat
- schlägt das Umschalten fehl (etwa durch eine Richtlinie), steht der Grund rot im Panel
- **Updates:** beim Öffnen und mit **Nach Updates suchen** fragt sie alle Marketplaces nach neueren Versionen; ein Plugin mit Update zeigt „↑ 0.5.0 verfügbar“ und einen Knopf **Aktualisieren**, bei mehreren gibt es **Alle aktualisieren**. Die neue Version gilt ab der nächsten Session. Plugins, deren Marketplace keine Version nennt (sie werden von anderswo geholt), zeigen kein Update an
- **Einstellungen:** ein Mod mit Optionen hat einen Knopf **Einstellungen**, der sie direkt im Panel aufklappt: An/Aus-Schalter, Auswahl-Knöpfe und Eingabefelder für Zahlen und Text. Eine Änderung wird wie in `/config` gespeichert und gilt sofort
- **Advisor:** oben im Panel steht, ob der Advisor an ist und mit welchem Modell, mit einem Knopf **Ausschalten** / **Einschalten**. Er ändert `advisorModel` in deinen User-Settings (`~/.claude/settings.json`), wie `/advisor` es tut; beim Ausschalten merkt sich die Zentrale das Modell und holt es beim Einschalten zurück (ohne gemerktes Modell: `opus`). Das Widget zeigt den Stand mit an
- **Liste neu laden** liest die Liste neu
- die Zentrale selbst lässt sich dort nicht ausschalten, damit der Weg zurück offen bleibt

Unter der Haube nutzt sie `claude plugin list`, `enable`, `disable`, `update` und `marketplace update` des Claude Code, das gerade läuft, und für die Einstellungen dieselben Zeilen wie `/config`.

Braucht Claude Code 2.1.325 oder neuer.

## Installieren

Am Prompt einer Terminal-Session:

```
/plugin install mod-zentrale --marketplace CHief-Wiggum1203/claude-mod-zentrale
```

`y` bestätigt den Marketplace, dann einen Scope wählen.

Aus einer Shell:

```bash
claude plugin install mod-zentrale --marketplace CHief-Wiggum1203/claude-mod-zentrale
```

In der Desktop-App: neben dem Prompt auf **+** klicken, dann **Plugins**, **Add marketplace** mit `CHief-Wiggum1203/claude-mod-zentrale`, dann **Add plugin**.
