# mod-zentrale

Ein Claude-Code-Mod: ein Panel **„Mod-Zentrale“**, in dem du alle installierten Mods und Plugins siehst und per Knopf ein- und ausschaltest.

- `/mods` öffnet das Panel und liest die aktuelle Liste
- zuerst die **Mods** (Plugins mit eigenem Hooks-Modul), dann die **weiteren Plugins**
- pro Eintrag: an (●) oder aus (○), Name, Version, Marketplace und Beschreibung
- **Ausschalten** / **Einschalten** schaltet das Plugin in dem Scope um, in dem es installiert ist (user, project oder local), mit kurzer Meldung
- ein umgeschaltetes Plugin ist markiert mit „gilt ab der nächsten Session“: die laufende Session behält, was sie geladen hat
- schlägt das Umschalten fehl (etwa durch eine Richtlinie), steht der Grund rot im Panel
- **Aktualisieren** liest die Liste neu
- die Zentrale selbst lässt sich dort nicht ausschalten, damit der Weg zurück offen bleibt

Unter der Haube nutzt sie `claude plugin list --json`, `claude plugin enable` und `claude plugin disable` des Claude Code, das gerade läuft.

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
