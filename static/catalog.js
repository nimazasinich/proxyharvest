export const BUILD = '18.0.0-space-pipeline';
export const CANONICAL_WORKER = 'https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev';

export const SOURCES = [
  {id:'morpheus-wg', name:'Morpheus WireGuard', url:'https://raw.githubusercontent.com/morpheusadam/v2ray-config/main/subs/bundles/wireguard.txt', protocol:'wireguard', tier:'A', verified:true, enabled:true},
  {id:'argh94-wg', name:'Argh94 WireGuard', url:'https://raw.githubusercontent.com/Argh94/Proxy-List/main/WireGuard.txt', protocol:'wireguard', tier:'A', verified:true, enabled:true},
  {id:'matin-super', name:'MatinGhanbari Super', url:'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/v2ray/super-sub.txt', protocol:'mixed', tier:'A', verified:true, enabled:true},
  {id:'mehrtat-vless', name:'Mehrtat VLESS Collector', url:'https://raw.githubusercontent.com/mehrtat/vless-collector/main/vless.txt', protocol:'vless', tier:'A', verified:true, enabled:true},
  {id:'barry-all', name:'Barry-far All', url:'https://raw.githubusercontent.com/barry-far/V2ray-config/main/All_Configs_Sub.txt', protocol:'mixed', tier:'A', verified:true, enabled:true},
  {id:'epodonios-all', name:'Epodonios All', url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt', protocol:'mixed', tier:'B', verified:true, enabled:true},
  {id:'mahdibland-eternity', name:'Mahdibland Eternity', url:'https://raw.githubusercontent.com/mahdibland/ShadowsocksAggregator/master/Eternity.txt', protocol:'ss', tier:'B', verified:true, enabled:true},
  {id:'mahdibland-v2ray', name:'Mahdibland V2Ray Aggregator', url:'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge_base64.txt', protocol:'mixed', tier:'B', verified:true, enabled:true},
  {id:'peasoft', name:'Peasoft NoMoreWalls', url:'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt', protocol:'mixed', tier:'B', verified:true, enabled:true},
  {id:'roosterkid', name:'Roosterkid V2RAY', url:'https://raw.githubusercontent.com/roosterkid/openproxylist/main/V2RAY_RAW.txt', protocol:'mixed', tier:'B', verified:true, enabled:true},
  {id:'surf-vless', name:'Surfboard VLESS', url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/vless', protocol:'vless', tier:'B', verified:true, enabled:true},
  {id:'surf-vmess', name:'Surfboard VMess', url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/vmess', protocol:'vmess', tier:'B', verified:true, enabled:false},
  {id:'surf-trojan', name:'Surfboard Trojan', url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/trojan', protocol:'trojan', tier:'B', verified:true, enabled:false},
  {id:'solispirit', name:'SoliSpirit All', url:'https://raw.githubusercontent.com/SoliSpirit/v2ray-configs/main/all_configs.txt', protocol:'mixed', tier:'C', verified:true, enabled:false},
  {id:'aiboboxx', name:'Aiboboxx V2rayfree', url:'https://raw.githubusercontent.com/aiboboxx/v2rayfree/main/v2', protocol:'mixed', tier:'C', verified:true, enabled:false},
  {id:'iran-cypher', name:'IranianCypherpunks Mix', url:'https://raw.githubusercontent.com/IranianCypherpunks/sub/main/config', protocol:'mixed', tier:'C', verified:true, enabled:false},
];

export const IRCF = {
  warpKeyLite:'https://raw.githubusercontent.com/ircfspace/warpkey/main/plus/lite',
  warpKeyFull:'https://raw.githubusercontent.com/ircfspace/warpkey/main/plus/full',
  endpointJson:'https://raw.githubusercontent.com/ircfspace/endpoint/main/ip.json',
  tconfig:'https://raw.githubusercontent.com/ircfspace/tconfig/main/sub/mix',
};
