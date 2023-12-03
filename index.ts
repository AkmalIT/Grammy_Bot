import { Bot, InlineKeyboard, session, SessionFlavor, Context } from "grammy";
import { Pool, QueryResult } from "pg";

interface User {
  id: number;
  username?: string;
}

interface Playlist {
  id: number;
  name: string;
}

interface PlaylistItem {
  userId: number;
  playlistId: number;
  file_id: string;
}

interface MySessionData {
  user?: User;
  file_id?: string;
  selectPlaylistId?: number;
  pendingAction?: string;
}

type MyContext = Context & SessionFlavor<MySessionData>;

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "akmal02032009",
  database: "grammy-music-bot",
});

async function findUserPlaylists(userId: number): Promise<Playlist[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT * FROM playlists WHERE userId = $1",
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function createPlaylist(userId: number, name: string): Promise<Playlist> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "INSERT INTO playlists (userId, name) VALUES ($1, $2) RETURNING *",
      [userId, name]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function findOrCreateUser(
  userId: number,
  username: string
): Promise<User> {
  const client = await pool.connect();
  try {
    let user: QueryResult<User> = await client.query(
      "SELECT * FROM users WHERE userId = $1",
      [userId]
    );
    if (user.rows.length === 0) {
      user = await client.query(
        "INSERT INTO users (userId, username) VALUES ($1, $2) RETURNING *",
        [userId, username]
      );
    }
    return user.rows[0];
  } finally {
    client.release();
  }
}

async function findPlaylistItems(
  playlistId: string | number
): Promise<PlaylistItem[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT * FROM playlistItems WHERE playlistId = $1",
      [playlistId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function createPlaylistItem(
  userId: number,
  playlistId: number,
  file_id: string
): Promise<PlaylistItem> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "INSERT INTO playlistItems (userId, playlistId, file_id) VALUES ($1, $2, $3) RETURNING *",
      [userId, playlistId, file_id]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

const bot = new Bot<MyContext>("YOUR_BOT_TOKEN");
bot.use(session({ initial: () => ({}) }));

bot.command("start", async (ctx: MyContext) => {
  if (!ctx.msg?.from?.id) return await ctx.reply("No id");
  ctx.session.user = {
    id: ctx?.msg?.from?.id,
    username: ctx?.msg?.from?.username,
  };
  await ctx.reply(
    "Привет! Отправьте мне аудиофайл, и я добавлю его в ваш плейлист."
  );
});

bot.command("myplaylists", async (ctx: MyContext) => {
  if (!ctx.msg?.from?.id) return await ctx.reply("No id");
  ctx.session.user = {
    id: ctx?.msg?.from?.id,
    username: ctx?.msg?.from?.username,
  };

  if (!(ctx.session.user && ctx.session.user.id)) {
    return await ctx.reply("User not found.");
  }

  const userId = ctx.session.user.id;
  const userPlaylists = await findUserPlaylists(userId);

  if (userPlaylists.length === 0) {
    await ctx.reply("У вас нет плейлистов. Хотите создать новый?", {});
    await ctx.reply("/createplaylist");
    return;
  }

  const keyboard = new InlineKeyboard();
  userPlaylists.forEach((playlist) => {
    keyboard.text(playlist.name, `select_playlist:${playlist.id}`).row();
  });

  await ctx.reply("Ваши плейлисты:", {
    reply_markup: keyboard,
  });
});

bot.command("createplaylist", async (ctx: MyContext) => {
  if (!ctx.msg?.from?.id) return await ctx.reply("No id");
  ctx.session.user = {
    id: ctx?.msg?.from?.id,
    username: ctx?.msg?.from?.username,
  };

  if (!ctx.session.user || !ctx.session.user.id) {
    return await ctx.reply("User not found.");
  }

  await ctx.reply("Введите название нового плейлиста:");
  ctx.session.pendingAction = "createPlaylist";
});
bot.command("help", async (ctx) => {
  const commands = [
    "/start - Начать использование бота",
    "/myplaylists - Прослушать песню из плейлиста",
    "/createplaylist - создать плейлист",
    "/help - Показать список доступных команд",
  ];

  await ctx.reply(commands.join("\n"));
});

bot.on(":text", async (ctx: MyContext) => {
  if (!ctx.msg?.from?.id) return await ctx.reply("No id");
  ctx.session.user = {
    id: ctx?.msg?.from?.id,
    username: ctx?.msg?.from?.username,
  };

  if (!ctx.session.user || !ctx.session.user.id || !ctx.session.pendingAction) {
    return await ctx.reply("User not found or invalid action.");
  }

  const userId = ctx.session.user.id;
  const action = ctx.session.pendingAction;

  if (action === "createPlaylist") {
    const playlistName = ctx.message?.text;
    if (playlistName) {
      await createPlaylist(userId, playlistName);
      await ctx.reply(`Плейлист "${playlistName}" создан.`);
      delete ctx.session.pendingAction;
    } else {
      await ctx.reply("Пожалуйста, введите название плейлиста.");
    }
  }
});

bot.on(":audio", async (ctx: MyContext) => {
  if (ctx?.msg?.from?.id) {
    ctx.session.user = {
      id: ctx?.msg?.from?.id,
      username: ctx?.msg?.from?.username,
    };

    if (ctx?.message?.audio && ctx?.message?.audio?.file_id && ctx?.from) {
      const file_id = ctx.message.audio.file_id;

      const user = await findOrCreateUser(
        ctx.msg.from.id,
        ctx.msg.from.username || ""
      );
      const playlists = await findUserPlaylists(ctx.msg.from.id);

      const keyboard = new InlineKeyboard();

      playlists.forEach((playlist) => {
        keyboard.text(playlist["name"], `add_to_playlist:${playlist.id}`);
      });

      await ctx.reply("Выберите плейлист:", { reply_markup: keyboard });

      ctx.session.user = user;
      ctx.session.file_id = file_id;
    }
  }
});

bot.on("callback_query", async (ctx: MyContext) => {
  if (!(ctx?.session?.user && ctx?.callbackQuery?.data)) {
    return ctx.reply("/start");
  }

  const user = ctx.session.user;
  const file_id = ctx.session.file_id;

  const callbackData = ctx?.callbackQuery?.data;

  if (callbackData.startsWith("add_to_playlist:")) {
    if (!(file_id && user)) return await ctx.reply("Send audio");
    const playlistId = parseInt(callbackData.split(":")[1], 10);
    await createPlaylistItem(user.id, playlistId, file_id);
    await ctx.reply("Аудиофайл добавлен в плейлист");
  }

  if (callbackData.startsWith("select_playlist:")) {
    try {
      const playlistId = parseInt(callbackData.split(":")[1], 10);
      ctx.session.selectPlaylistId = playlistId;

      const playlistItems = await findPlaylistItems(playlistId);

      if (playlistItems.length === 0) {
        return ctx.reply("В выбранном плейлисте нет аудиофайлов.");
      }

      const keyboard = new InlineKeyboard();
      playlistItems.forEach((item, index) => {
        keyboard.text(`Song ${index + 1}`, `play_song:${index + 1}`).row();
      });

      await ctx.reply("Выберите песню для прослушивания:", {
        reply_markup: keyboard,
      });
    } catch (error) {
      console.log(error);
    }
  }

  if (callbackData.startsWith("play_song:")) {
    const songIndex = parseInt(callbackData.split(":")[1], 10);
    const playlistId = String(ctx?.session?.selectPlaylistId);

    const playlistItems = await findPlaylistItems(playlistId);

    if (songIndex >= 1 && songIndex <= playlistItems.length) {
      const selectedSong = playlistItems[songIndex - 1];
      const file_id = selectedSong.file_id;
      await ctx.reply("Вот ваша песня");
      await ctx.replyWithAudio(file_id);
    } else {
      await ctx.reply("Некорректный выбор песни.");
    }
  }
});

bot.catch((err) => {
  if (err instanceof Error) {
    console.error(`Error ${err.message}`);
  }
});

bot.start();
console.log("Bot started");
