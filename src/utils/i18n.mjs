const dictionaries = {
  en: {
    approvalSettings: 'Approval Settings',
    contacts: 'Contacts',
    currentLoginAccount: 'Current login account',
    customers: 'Customers',
    invalidLogin: 'Invalid username or password',
    login: 'Login',
    logout: 'Logout',
    opportunities: 'Opportunities',
    password: 'Password',
    primaryNavigation: 'Primary navigation',
    roles: 'Roles',
    system: 'System',
    users: 'Users',
    username: 'Username',
    workbench: 'Workbench'
  },
  zh: {
    approvalSettings: '审批人配置',
    contacts: '联系人',
    currentLoginAccount: '当前登录账号',
    customers: '客户',
    invalidLogin: '用户名或密码错误',
    login: '登录',
    logout: '退出登录',
    opportunities: '商机',
    password: '密码',
    primaryNavigation: '主导航',
    roles: '角色',
    system: '系统',
    users: '用户',
    username: '用户名',
    workbench: '工作台'
  }
};

export function normalizeLanguage(value) {
  return value === 'zh' ? 'zh' : 'en';
}

export function createTranslator(language) {
  const normalized = normalizeLanguage(language);
  return (key) => dictionaries[normalized][key] || dictionaries.en[key] || key;
}
