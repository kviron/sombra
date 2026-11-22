/** Приложение живёт на hash-адресах: их пишут точка входа, роутер и выход из аккаунта. */
export const AppRoutes = {
 home: '',
 chat: '#chat',
 login: '#login',
 register: '#register'
} as const;

export type AppRoute = (typeof AppRoutes)[keyof typeof AppRoutes];

export const getRouteHome = () => AppRoutes.home;
export const getRouteChat = () => AppRoutes.chat;
export const getRouteLogin = () => AppRoutes.login;
export const getRouteRegister = () => AppRoutes.register;
