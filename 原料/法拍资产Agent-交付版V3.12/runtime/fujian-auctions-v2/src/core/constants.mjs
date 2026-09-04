export const ALIBABA_LIST_URL =
  "https://sf.taobao.com/list/0____%B8%A3%BD%A8.htm?auction_source=0&st_param=4&auction_start_seg=-1";

export const ALIBABA_PC_LIST_URL =
  "https://huodong.taobao.com/wow/pm/default/pc/4b05fb";

export const ALIBABA_PC_PROPERTY_IDS = {
  住宅用房: "1",
  工业用房: "2",
  商业用房: "3",
};

export const ALIBABA_PC_LOCATION_CODES = {
  福建省: "350000",
  福州市: "350100",
  厦门市: "350200",
  莆田市: "350300",
  三明市: "350400",
  泉州市: "350500",
  漳州市: "350600",
  南平市: "350700",
  龙岩市: "350800",
  宁德市: "350900",
};

export const ALIBABA_CATEGORY_IDS = {
  住宅用房: "50025969",
  商业用房: "200782003",
  工业用房: "200788003",
};

export const JD_LIST_URL = "https://pmsearch.jd.com/";

export const CATEGORIES = {
  住宅用房: "101",
  商业用房: "102",
  工业用房: "103",
};

export const STATUS_FILTERS = ["即将开始", "已结束"];
export const OUTPUT_PROPERTY_TYPES = new Set(["车位", "住宅", "别墅", "商业", "工业"]);
export const ACTIVE_STATUSES = new Set(["即将开始", "正在进行", "待核验"]);
// 京东对连续筛选、翻页和详情跳转较敏感。保持随机低频区间，避免固定节拍；
// 相比旧版3–5秒增加约1.5–2.5秒，换取更低的认证触发率。
export const JD_ACTION_DELAY_MIN_MS = 4_000;
export const JD_ACTION_DELAY_MAX_MS = 5_000;

export const FUJIAN_AREAS = {
  福州市: ["鼓楼区", "台江区", "仓山区", "马尾区", "晋安区", "长乐区", "闽侯县", "连江县", "罗源县", "闽清县", "永泰县", "平潭县", "福清市", "平潭综合实验区"],
  厦门市: ["思明区", "海沧区", "湖里区", "集美区", "同安区", "翔安区"],
  莆田市: ["城厢区", "涵江区", "荔城区", "秀屿区", "仙游县"],
  三明市: ["三元区", "沙县区", "明溪县", "清流县", "宁化县", "大田县", "尤溪县", "将乐县", "泰宁县", "建宁县", "永安市"],
  泉州市: ["鲤城区", "丰泽区", "洛江区", "泉港区", "惠安县", "安溪县", "永春县", "德化县", "金门县", "石狮市", "晋江市", "南安市", "泉州台商投资区"],
  漳州市: ["芗城区", "龙文区", "龙海区", "长泰区", "云霄县", "漳浦县", "诏安县", "东山县", "南靖县", "平和县", "华安县"],
  南平市: ["延平区", "建阳区", "顺昌县", "浦城县", "光泽县", "松溪县", "政和县", "邵武市", "武夷山市", "建瓯市"],
  龙岩市: ["新罗区", "永定区", "长汀县", "上杭县", "武平县", "连城县", "漳平市"],
  宁德市: ["蕉城区", "霞浦县", "古田县", "屏南县", "寿宁县", "周宁县", "柘荣县", "福安市", "福鼎市"],
};
