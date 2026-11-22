import {clearSession, session} from '../transport';

/**
 * Токен сеанса — это состояние транспорта, а не операция API. Сервис нужен, чтобы
 * проверки «сеанс не сменился» в интерфейсе не зависели от внутренностей транспорта.
 */
export const sessionService = {
 token: () => session(),
 clear: () => clearSession(),
};
