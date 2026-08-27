// Kasa Sistemi + Banka Demo - tek ortak backend
// Tek kullanıcı havuzu: banka demosunda kazanılan bakiye kasa sisteminde harcanır.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_DATA = {
  users: {},
  vaults: [
    { name: 'Kasa 1', link: 'https://www.googleapis.com/drive/v3/files/12nb4J6Un0oiaftZYr1ueUgBHIzFUPlFr?key=AIzaSyB3N6-vPUjJ4Hf3icvXCOwUZiTig5qv09o&alt=media', premium: false },
    { name: 'Kasa 2', link: 'https://example.com/2', premium: false },
    { name: 'Kasa 3', link: 'https://example.com/3', premium: false },
    { name: 'Kasa 4', link: 'https://example.com/4', premium: true },
    { name: 'Kasa 5', link: 'https://example.com/5', premium: true }
  ],
  vaultPrice: 10,
  premiumPrice: 20,
  adminPass: 'googleapis',
  ad: { text: 'Buraya reklam metnini yaz', link: 'https://example.com' },
  startBalance: 0,
  unlimitedUsers: []
};

function loadData(){
  if(!fs.existsSync(DATA_FILE)){
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if(!data.unlimitedUsers) data.unlimitedUsers = [];
  if(data.vaultPrice === undefined) data.vaultPrice = 10;
  if(data.premiumPrice === undefined) data.premiumPrice = 20;
  return data;
}
function saveData(data){ fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function isUnlimited(data, username){ return data.unlimitedUsers.includes(username); }

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  const data = loadData();
  if(data.users[username]) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
  data.users[username] = { password, balance: data.startBalance, log: [], unlockedVaults: [], isPremium: false };
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users[username];
  if(!user || user.password !== password) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  res.json({ ok: true, isPremium: !!user.isPremium });
});

app.post('/api/me', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users[username];
  if(!user || user.password !== password) return res.status(401).json({ error: 'Geçersiz kullanıcı.' });
  res.json({
    balance: user.balance,
    unlimited: isUnlimited(data, username),
    log: user.log,
    isPremium: !!user.isPremium,
    unlockedVaults: user.unlockedVaults || []
  });
});

app.post('/api/transfer', (req, res) => {
  const { from, password, to, amount } = req.body;
  const amt = parseFloat(amount);
  const data = loadData();
  const sender = data.users[from];
  const receiver = data.users[to];

  if(!sender || sender.password !== password) return res.status(401).json({ error: 'Gönderen doğrulanamadı.' });
  if(!receiver) return res.status(400).json({ error: 'Alıcı kullanıcı bulunamadı.' });
  if(from === to) return res.status(400).json({ error: 'Kendine gönderemezsin.' });
  if(!amt || amt <= 0) return res.status(400).json({ error: 'Geçersiz tutar.' });

  const senderUnlimited = isUnlimited(data, from);
  if(!senderUnlimited && sender.balance < amt) return res.status(400).json({ error: 'Yetersiz bakiye.' });

  if(!senderUnlimited) sender.balance -= amt;
  receiver.balance += amt;
  sender.log.push({ type: 'out', to, amount: amt, date: new Date().toISOString() });
  receiver.log.push({ type: 'in', from, amount: amt, date: new Date().toISOString() });

  saveData(data);
  res.json({ ok: true, balance: sender.balance });
});

app.get('/api/vaults', (req, res) => {
  const data = loadData();
  res.json({
    vaultPrice: data.vaultPrice,
    premiumPrice: data.premiumPrice,
    vaults: data.vaults.map(v => ({ name: v.name, premium: v.premium }))
  });
});

app.post('/api/vaults/buy', (req, res) => {
  const { username, password, index } = req.body;
  const data = loadData();
  const user = data.users[username];
  if(!user || user.password !== password) return res.status(401).json({ error: 'Geçersiz kullanıcı.' });
  const vault = data.vaults[index];
  if(!vault) return res.status(404).json({ error: 'Kasa bulunamadı.' });

  if(vault.premium && !user.isPremium){
    return res.status(403).json({ error: 'Bu kasa premium üyelere özel. Önce premium ol.' });
  }

  user.unlockedVaults = user.unlockedVaults || [];
  if(user.unlockedVaults.includes(Number(index))){
    return res.json({ ok: true, link: vault.link, alreadyOwned: true });
  }

  const unlimited = isUnlimited(data, username);
  const price = data.vaultPrice;
  if(!unlimited && user.balance < price){
    return res.status(400).json({ error: `Yetersiz bakiye. Bu kasa ${price} TMT.` });
  }

  if(!unlimited) user.balance -= price;
  user.unlockedVaults.push(Number(index));
  user.log.push({ type: 'out', to: vault.name + ' (kasa satın alma)', amount: price, date: new Date().toISOString() });

  saveData(data);
  res.json({ ok: true, link: vault.link, balance: user.balance });
});

app.post('/api/premium/buy', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users[username];
  if(!user || user.password !== password) return res.status(401).json({ error: 'Geçersiz kullanıcı.' });
  if(user.isPremium) return res.json({ ok: true, alreadyPremium: true });

  const unlimited = isUnlimited(data, username);
  const price = data.premiumPrice;
  if(!unlimited && user.balance < price){
    return res.status(400).json({ error: `Yetersiz bakiye. Premium ${price} TMT.` });
  }

  if(!unlimited) user.balance -= price;
  user.isPremium = true;
  user.log.push({ type: 'out', to: 'Premium üyelik', amount: price, date: new Date().toISOString() });

  saveData(data);
  res.json({ ok: true, balance: user.balance });
});

app.get('/api/ad', (req, res) => {
  const data = loadData();
  res.json(data.ad);
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const data = loadData();
  if(password !== data.adminPass) return res.status(401).json({ error: 'Yönetici şifresi yanlış.' });
  res.json({ ok: true });
});

app.post('/api/admin/settings', (req, res) => {
  const { adminPassword } = req.body;
  const data = loadData();
  if(adminPassword !== data.adminPass) return res.status(401).json({ error: 'Yönetici şifresi yanlış.' });
  res.json({
    vaults: data.vaults,
    vaultPrice: data.vaultPrice,
    premiumPrice: data.premiumPrice,
    adminPass: data.adminPass,
    ad: data.ad,
    startBalance: data.startBalance,
    unlimitedUsers: data.unlimitedUsers,
    userList: Object.keys(data.users)
  });
});

app.post('/api/admin/save', (req, res) => {
  const { adminPassword, vaults, vaultPrice, premiumPrice, newAdminPass, ad, startBalance, unlimitedUsers } = req.body;
  const data = loadData();
  if(adminPassword !== data.adminPass) return res.status(401).json({ error: 'Yönetici şifresi yanlış.' });

  if(Array.isArray(vaults)) data.vaults = vaults;
  if(vaultPrice !== undefined && !isNaN(parseFloat(vaultPrice))) data.vaultPrice = parseFloat(vaultPrice);
  if(premiumPrice !== undefined && !isNaN(parseFloat(premiumPrice))) data.premiumPrice = parseFloat(premiumPrice);
  if(newAdminPass) data.adminPass = newAdminPass;
  if(ad) data.ad = ad;
  if(startBalance !== undefined && !isNaN(parseFloat(startBalance))) data.startBalance = parseFloat(startBalance);
  if(Array.isArray(unlimitedUsers)) data.unlimitedUsers = unlimitedUsers;

  saveData(data);
  res.json({ ok: true });
});

app.post('/api/admin/set-balance', (req, res) => {
  const { adminPassword, username, balance } = req.body;
  const data = loadData();
  if(adminPassword !== data.adminPass) return res.status(401).json({ error: 'Yönetici şifresi yanlış.' });
  if(!data.users[username]) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
  data.users[username].balance = parseFloat(balance);
  saveData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});