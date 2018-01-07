# ksnctf C92

https://ksnctfc92.sweetduet.info で動かしていたスコアサーバー。

```
# config.example.jsonをconfig.jsonにコピーし設定を書き換える
sqlite3 database.db < database.sql
npm install
npm start
```

## config.json

|項目|説明|
|---|---|
|URL|スコアサーバーを動かすURL|
|SESSION_SECRET|Cookieに署名するためのランダム文字列。外部に公開するならば書き換え必須|
|TWITTER_CONSUMER_KEY|Twitterログイン用|
|TWITTER_CONSUMER_SECRET|Twitterログイン用|
|PROBLEMS|問題。 https://github.com/kusano/ksnctfc92_problem のproblemsを指定すると、コンテスト開催時と同じ問題になる|
|HIDDEN_KEY|/hiddenで入力すると表の問題を全て解かなくても裏モードに入れるパスワード|
|END_TIME|終了日時。この日時以降はスコアが更新されなくなる|
