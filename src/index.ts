import 'ws-tox-protocol';

class Tox {
    socket: WebSocket
    eventTarget: EventTarget
    requestQueue: [(value: ToxResponse) => void, (reason: any) => void][]

    constructor() {
        const socket = new WebSocket("ws://127.0.0.1:2794")
        socket.addEventListener("message", (ev) => this.onWsMessage(ev))

        const target = new EventTarget()

        this.socket = socket
        this.eventTarget = target
        this.requestQueue = []
    }

    pushResponse(response: ToxResponse) {
        const target = this.requestQueue.shift()

        if(target) {
            target[0](response)
        };
    }

    onWsMessage(event: MessageEvent) {
        if(typeof event.data === "string") {
            // FIXME: this code does no validation
            const data = JSON.parse(event.data.toString())

            if(data.response !== undefined) {
                this.pushResponse(data as ToxResponse)
            }
            else if(data.event !== undefined) {
                const event = new CustomEvent(
                    "core",
                    { detail: data as ToxEvent }
                )

                this.eventTarget.dispatchEvent(event)
            }
        }
    }
    addEventListener(type: "core", listener: EventListener) {
        this.eventTarget.addEventListener(type, listener)
    }

    info(): Promise<ToxResponse> {
        return new Promise((accept, reject) => {
            const request: ToxRequest = { "request": "Info" }

            this.socket.send(JSON.stringify(request));
            this.requestQueue.push([accept, reject])
        })
    }
    addFriend(toxId: string, message?: string): Promise<ToxResponse> {
        return new Promise((accept, reject) => {
            let request: ToxRequest;

            if(message !== undefined) {
                request = { request: "AddFriend", tox_id: toxId, message }
            }
            else {
                request = { request: "AddFriendNorequest", tox_id: toxId }
            }

            this.socket.send(JSON.stringify(request));
            this.requestQueue.push([accept, reject])
        })
    }
    sendFriendMessage(friend: number, kind: MessageType, message: string): Promise<ToxResponse> {
        return new Promise((accept, reject) => {
            const request: ToxRequest = { "request": "SendFriendMessage", friend, kind, message }

            this.socket.send(JSON.stringify(request));
            this.requestQueue.push([accept, reject])
        })
    }
}

type Action =
    { action: "help" } |
    { action: "info", friend: number | null } |
    { action: "add", toxId: string, message: string | null } |
    { action: "chat", friend: number };

class Commander {
    evaluate(command: string): Action | null {
        const split = command.split(' ');
        const input = new Input(split.slice(1).join(' '))

        return this.evalCommand(split[0], input)
    }

    evalCommand(command: string, input: Input): Action | null {
        switch(command) {
            case "help": {
                if(!input.isOver()) {
                    return null
                }

                return { action: "help" }
            }
            case "info": {
                const target = input.readWord();

                let friend: number | null;
                if(target !== null) {
                    friend = parseInt(target);
                    if(isNaN(friend)) { return null }
                }
                else {
                    friend = null
                }

                return { action: "info", friend: friend }
            }
            case "add": {
                const toxId = input.readWord()
                const message = input.readLine()

                if(toxId === null) {
                    return null
                }

                return { action: "add", toxId, message }
            }
            case "chat": {
                const arg = input.readWord()

                let friend = null
                if(arg !== null) {
                    friend = parseInt(arg);
                }

                if(friend === null) {
                    return null
                }

                return { action: "chat", friend }
            }
            default:
                return null
        }

        return null
    }
}

class Input {
    input: string;

    constructor(input: string) {
        this.input = input
    }

    readWord(): string | null {
        const split = this.input.split(' ');
        const word_ix = split.findIndex(s => s !== "")

        if(word_ix !== -1) {
            this.input = split.slice(word_ix + 1).join(' ')

            return split[word_ix]
        }

        return null
    }

    readLine(): string | null {
        if(this.isOver()) { return null }

        const line = this.input;

        this.input = ""

        return line
    }

    isOver(): boolean {
        const split = this.input.split(' ');

        return split.findIndex(s => s !== "") === -1
    }
}

class Client {
    tox: Tox
    commander: Commander
    chatWith: number | null

    constructor() {
        const tox = new Tox()

        tox.addEventListener("core", ((ev: CustomEvent<ToxEvent>) => {
            this.onToxEvent(ev.detail)
        }) as EventListener)

        this.tox = tox
        this.commander = new Commander()
        this.chatWith = null
    }

    runCommand(command: string) {
        const action = this.commander.evaluate(command)

        if(action === null) { return }

        let response = null
        switch (action.action) {
            case "help":
                const msgs = [
                    "Available commands:",
                    "/help : shows this help message",
                    "/info : get your name and Tox ID",
                    "/add toxId [message] : add a friend. If no message, the friend will be added without a friend request",
                    "/chat num : start chat with the friend with the id `num`"
                ]

                msgs.forEach(m => printMessage(m))
                break
            case "info":
                response = this.tox.info()

                break;
            case "add":
                if(action.message !== null) {
                    response = this.tox.addFriend(action.toxId, action.message)
                } else {
                    response = this.tox.addFriend(action.toxId)
                }
                break
            case "chat":
                printMessage("Chat with: " + action.friend)
                this.chatWith = action.friend
            default:
                break;
        }

        if(response !== null) {
            response.then((response) => printMessage(JSON.stringify(response)))
        }
    }

    onChatMessage(message: string) {
        if(message.charAt(0) === '/') {
            this.runCommand(message.substr(1))

            return
        }

        if(this.chatWith !== null) {
            printMessage("> " + message)
            this.tox
                .sendFriendMessage(this.chatWith, "Normal", message)
                .then((response) => printMessage("< " + JSON.stringify(response)))
        }
    }

    onToxEvent(event: ToxEvent) {
        printMessage(JSON.stringify(event))
    }
}

let client = new Client()

function init() {
    document.getElementById("chat-input-textarea")!.addEventListener("keypress", function(ev) {
        if (ev.keyCode === 13) {
            const value = (this as HTMLTextAreaElement).value;

            client.onChatMessage(value);

            (this as HTMLTextAreaElement).value = ""
            ev.preventDefault()
        }
    })
}

function printMessage(msg: string) {
    const chat = document.getElementById("chat-content")!
    const p = document.createElement("div")
    p.appendChild(document.createTextNode(msg))

    chat.appendChild(p)
}

window.addEventListener("load", init)
