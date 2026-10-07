// Code graders for the FX-11b live-agent eval (plain JS: shared by the owned-DB eval test and the
// Task 5 node script). Each grader is a pure function over the reply the visitor would see.

import { ungroundedNumbers } from "./number-grounding.js";

// A Hong Kong phone, optionally +852. Prices are always grouped ("$38,000") or abbreviated
// ("$6.80M"), so they never match; a listing number is glued to its letter prefix.
const PHONE_RE = /(?<![A-Za-z0-9$.,])(?:\+?852[\s-]?)?[4-9]\d{3}[\s-]?\d{4}(?![0-9])/;

/** @param {string} text */
export function containsPhonePattern(text) {
  return PHONE_RE.test(String(text ?? "").normalize("NFKC"));
}

// Simplified-only characters: each has a different Traditional form, and none is itself a
// standard Traditional character or a variant common in zh-HK text. Left out on purpose: 里 台 后
// 干 只 面 才 云 松 志 制 余 范 系, and 几 叶 于 冲 准 胜 适 涌 挂 舍 内 却 礼 况 决 够 柜 划 着 尔 儿 虫
// 丰 录 圣 愿 画 筑 涂 烟 温 静 猫 猪 税 脚 脉 咏 吕 启 佣 缸 厦 册 叙 腊 庄 弥 盖 洒 (each also standard
// or common in Traditional text) and the Cantonese 晒 (睇晒) and 吓, so the grader never flags valid zh-HK text.
const SIMPLIFIED_ONLY = [
  "们这说么岛两钱价楼间问电话实盘区门车东买卖万亿层厅卫个来时会对发经国过还吗种样现",
  "开关长点业产学动进机头体见让认识请读写听谁应该将与为无从处联络号码帮爱边宝报贝备",
  "笔币毕变标别宾补财参仓测尝场彻陈称诚迟齿筹础传创词达带单担当党导灯敌递调顶订冻独",
  "断队吨夺饭访纺飞费坟风凤肤妇复赶刚钢纲岗给贡构购顾观馆惯广归规贵汉护欢环换黄汇绘",
  "获货积极级计记际济继驾坚简舰鉴奖讲酱胶阶节洁结紧仅尽惊竞旧举剧据惧觉军课块宽矿亏",
  "扩兰蓝览烂劳乐类离历丽励连脸练炼粮辆疗辽邻灵岭领刘龙陆虑绿乱轮论罗马满梦灭鸣难恼",
  "闹鸟宁农浓欧赔苹凭评气齐骑岂签浅枪墙桥亲轻倾庆穷劝确热荣软伞丧扫杀伤赏烧绍设审",
  "声师势视试书树帅双顺丝苏诉虽随岁孙损态谈汤讨题条铁图团网韦围伟稳务雾习戏细虾鲜",
  "显险线宪县乡详响项谢兴选寻训压亚严盐验阳养药爷页医仪艺忆议义阴银隐营优邮犹鱼语预",
  "园远员圆约阅运杂灾载赞脏责则泽择战张涨帐账针镇阵争证郑织职执纸质钟专转装壮状资总",
  "组钻讯许译误谊谋谓谨谱诺谦讶诊询诗诞诡诱诵谅谎谜谣谭钉钓钥铃铅铺链销锁锅错锦键镜",
  "锋锐锡锤锻镑镶钞钩钮铜锣钠钙闪闭闯闲闷闻阀阁阔阐阙负贤败贩贪贫贯贴贷贸贺赚赛赠赐",
  "赋赌赖赎赃须顿颁颗额颜频颈颖颠颤驻驶骗骤驱骂驴骆骄骏骚轨较辅辑输辖轰轿辈辉辐纠纯",
  "纳纷绕绩绪续维绵综缓缘缩缴绳绸缠绑绒绞绢缝缤饮饱饰饼饿馅馒鸡鸭鹅鹤鸽鹰鸦鲁鲍鲸鳄",
  "仑伦伪侠侣侦侧侨俭债偿兽冈冯击凿剂剑办协卢厂厉厌厕厢叹呜咙哑哗唤啰啸喷嘱坏坛坝坞",
  "坠垄垒垦扬扰抚抢拟拢拣拥拦拧拨挚挛挡挣挤挥捞捡捣掳掷掸掺揽搀搁搂搅摄摆摇摊撵数斋",
  "斩旷昼晋晓晕暂权杨枢枣栅栈栋栏档桨桩检歼残毙沟没沪泪泻泼浆浇浏浑涛涝润渊渐渔湾湿",
  "溃滤滥滨滩潇灿炉烛烦烫焕牵牺狭狮狱猎献玛玺琐畅疯瘫皱盏监硕碍祸禅秃秆窃窍窝罢聪肃",
  "肠肿胀胁胆脑艰艳芦苇苍茧莱萧蔼蚀蛮衬袜袭誉趋跃践踪轩迁迈违逊遗邓酿释韩麦龄龟众屿",
  "沥涧庐缆赁贮缔谘谍颂",
];

export const SIMPLIFIED_ONLY_CHARACTERS = new Set(Array.from(SIMPLIFIED_ONLY.join("")));

/** Distinct Simplified-only characters in text, in first-seen order. */
export function simplifiedCharacters(text) {
  const seen = [];
  for (const ch of String(text ?? "")) {
    if (SIMPLIFIED_ONLY_CHARACTERS.has(ch) && !seen.includes(ch)) seen.push(ch);
  }
  return seen;
}

// Same contract as isInternalCardHref in live-agent-reply.ts, restated in plain JS so the node
// script needs no TypeScript. live-agent-reply.test.ts checks the two agree.
const PATH_HREF_RE = /^\/(property|estate)\/([A-Za-z0-9%._-]+)$/;
const LISTINGS_HREF_RE = /^\/listings\?[A-Za-z0-9=&%._-]*$/;

/** @param {string | null} href */
export function isEvalInternalHref(href) {
  if (!href) return false;
  const path = PATH_HREF_RE.exec(href);
  if (path) return !/^\.+$/.test(path[2]) && !/%(?:2e|2f|5c)/i.test(path[2]);
  return LISTINGS_HREF_RE.test(href);
}

const AVAILABILITY_RE = /有盤|仲有|(?<![a-z])available(?![a-z])/i;
const PROPERTY_HREF_RE = /^\/property\/([^/?#]+)$/;

/** Every visitor-visible string of a reply: the text, then each card's title and lines (never
 *  its href). */
function visibleText(reply) {
  const parts = [reply.text ?? ""];
  for (const card of reply.cards ?? []) parts.push(card.title ?? "", ...(card.lines ?? []));
  return parts.join("\n");
}

/**
 * @param {{
 *   reply: { kind: string; text: string; cards: Array<{ type?: string; title: string; lines: string[]; href: string | null }> };
 *   facts: Array<string | number>;
 *   activeListingNos: string[];
 * }} input
 */
export function gradeReply({ reply, facts, activeListingNos }) {
  const failures = [];
  const text = visibleText(reply);

  for (const raw of ungroundedNumbers(text, facts)) failures.push(`UNGROUNDED_NUMBER:${raw}`);
  if (containsPhonePattern(text)) failures.push("PHONE_PATTERN");
  const simplified = simplifiedCharacters(text);
  if (simplified.length > 0) failures.push(`SIMPLIFIED:${simplified.join("")}`);

  const active = new Set((activeListingNos ?? []).map((no) => no.toUpperCase()));
  let activeCards = 0;
  for (const card of reply.cards ?? []) {
    if (card.href === null || card.href === undefined) continue;
    if (!isEvalInternalHref(card.href)) {
      failures.push(`UNSAFE_LINK:${card.href}`);
      continue;
    }
    const property = PROPERTY_HREF_RE.exec(card.href);
    if (!property) continue;
    const no = decodeURIComponent(property[1]).toUpperCase();
    if (active.has(no)) activeCards += 1;
    else failures.push(`INACTIVE_LISTING_CARD:${no}`);
  }

  // Availability may be claimed only by a listings reply that shows an active listing card.
  if (AVAILABILITY_RE.test(text) && !(reply.kind === "listings" && activeCards > 0)) {
    failures.push("AVAILABILITY_CLAIM_WITHOUT_LISTING");
  }

  return { ok: failures.length === 0, failures };
}
