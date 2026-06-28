const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Rcon } = require("rcon-client");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// ===================== 配置区，全部替换成你自己的 =====================
const SUPABASE_URL = "你的supabase项目url";
const SUPABASE_KEY = "你的supabase anon密钥";
const STEAM_API_KEY = "你的steam webapi密钥";
const FRONT_URL = "你的vercel前端网址";

// DayZ Rcon配置
const RCON_HOST = "服务器IP";
const RCON_PORT = 2302;
const RCON_PWD = "Rcon密码";

// 初始化数据库
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Rcon工具
async function sendRconCmd(cmd){
    const rcon = new Rcon({host:RCON_HOST,port:RCON_PORT,password:RCON_PWD});
    await rcon.connect();
    const res = await rcon.send(cmd);
    rcon.end();
    return res;
}

// ===================== API接口 =====================
// 1. Steam登录跳转
app.get("/api/auth/steam", async (req,res)=>{
    const redirect = encodeURIComponent(`${FRONT_URL}`);
    const steamUrl = `https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to=${FRONT_URL}/callback&openid.realm=${FRONT_URL}&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select`;
    res.redirect(steamUrl);
})

// 2. Steam回调解析
app.get("/callback", async (req,res)=>{
    const openid = req.query["openid.identity"];
    const steamId = openid.split("/").pop();
    // 获取玩家昵称
    const userInfo = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`);
    const name = userInfo.data.response.players[0].personaname;
    // 入库
    await supabase.from("players").upsert({steamId,nick:name});
    res.redirect(`${FRONT_URL}?steamId=${steamId}&name=${encodeURIComponent(name)}`);
})

// 3. 获取商品列表
app.get("/api/goods", async (req,res)=>{
    const {data} = await supabase.from("goods").select("*");
    res.json(data);
})

// 4. 创建订单
app.post("/api/order/create", async (req,res)=>{
    const {steamId,goodsId} = req.body;
    const {data:goods} = await supabase.from("goods").select("*").eq("id",goodsId).single();
    const orderId = Date.now().toString();
    await supabase.from("orders").insert({
        orderId,steamId,goodsId,goodsName:goods.name,price:goods.price,status:"未支付"
    })
    res.json({code:200,orderId});
})

// 5. 玩家订单列表
app.get("/api/order/list", async (req,res)=>{
    const steamId = req.query.steamId;
    const {data} = await supabase.from("orders").select("*").eq("steamId",steamId).order("createAt",{asc:false});
    res.json(data);
})

// 6. 批量生成CDK
app.post("/api/cdk/generate", async (req,res)=>{
    const {num,goodsKey} = req.body;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const list = [];
    for(let i=0;i<num;i++){
        let code = "";
        for(let j=0;j<16;j++) code += chars[Math.floor(Math.random()*chars.length)];
        list.push({code,goodsKey,used:false});
    }
    await supabase.from("cdk").insert(list);
    res.json({code:200,list:list.map(x=>x.code)});
})

// 7. CDK兑换接口（自动Rcon发道具）
app.post("/api/cdk/exchange", async (req,res)=>{
    const {code,steamId} = req.body;
    const {data:cdk} = await supabase.from("cdk").select("*").eq("code",code).single();
    if(!cdk) return res.json({code:400,msg:"兑换码不存在"});
    if(cdk.used) return res.json({code:400,msg:"已使用"});
    // 标记已使用
    await supabase.from("cdk").update({used:true,steamId,useTime:new Date()}).eq("code",code);
    // Rcon下发道具（根据key执行对应指令）
    let rconCmd = "";
    switch(cdk.goodsKey){
        case "m4": rconCmd = `playerSpawnItem ${steamId} m4a1`; break;
        case "car": rconCmd = `spawnVehicle offroad`; break;
        case "vip": rconCmd = `setPlayerVIP ${steamId}`; break;
    }
    await sendRconCmd(rconCmd);
    res.json({code:200,msg:"兑换成功",data:{goodsKey:cdk.goodsKey,goodsName:cdk.goodsKey}});
})

// 8. 获取已使用CDK记录
app.get("/api/cdk/used", async (req,res)=>{
    const {data} = await supabase.from("cdk").select("*").eq("used",true).order("useTime",{asc:false});
    res.json(data);
})

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>{
    console.log(`后端运行端口:${PORT}`);
})