// ==UserScript==
// @name         PurpleCulture Sentences Highlighter
// @namespace    http://tampermonkey.net/
// @version      2024-12-22
// @description  Find and highlight Chinese sentences based on character sets
// @author       https://github.com/mcodelook
// @match        https://www.purpleculture.net/sample_sentences/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=purpleculture.net
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

// Configuration
const CONFIG = {
    LOAD_PAGES_COUNT: 4,
    REQUEST_DELAY_MS: 303,
    COLORS: {
        MATCHING_SENTENCE: '#BCB',
        MATCHING_CHARACTER: '#F9ff88'
    },
    CHINESE_PUNCTUATION: ['，', '。', '？', '！', '；', '：', '、', '（', '）', '《', '》', '“', '”', '‘', '’', '【', '】']
};

// Error types
class AppError extends Error {
    constructor(message, originalError = null) {
        super(message)
        this.name = this.constructor.name
        this.originalError = originalError
    }
}

class PageLoadError extends AppError { }
class ValidationError extends AppError { }

// URLUtils - Handles URL-related operations
const URLUtils = {
    getSearchWord: () => {
        const url = window.location.href
        const regex = new RegExp("[?&]word(=([^&#]*)|&|#|$)")
        const result = regex.exec(url)
        if (!result) return null
        if (!result[2]) return ''
        return decodeURIComponent(result[2].replace(/\+/g, " "))
    },

    getPageNumber: () => {
        const url = window.location.href
        const regex = /page=(\d+)/
        const match = url.match(regex)
        return match && match[1] ? parseInt(match[1]) : null
    },

    getNextPageUrl: (searchTerm, pageNumber) => {
        return `https://www.purpleculture.net/sample_sentences/?word=${searchTerm}&page=${pageNumber}`
    }
}

// UI Components
class UIComponent {
    constructor(element) {
        this.element = element
    }

    render(parent = document.body) {
        parent.appendChild(this.element)
    }
}

class Button extends UIComponent {
    constructor({ text, onClick, styles }) {
        const button = document.createElement('button')
        super(button)
        this.configure({ text, onClick, styles })
    }

    configure({ text, onClick, styles }) {
        this.element.textContent = text
        this.element.addEventListener('click', onClick)
        Object.assign(this.element.style, styles)
    }
}

class InfoPanel extends UIComponent {
    constructor({ text, styles }) {
        const div = document.createElement('div')
        super(div)
        this.configure({ text, styles })
    }

    configure({ text, styles }) {
        this.element.textContent = text
        Object.assign(this.element.style, styles)
    }

    updateText(text) {
        this.element.textContent = text
    }
}

class SentencePanel extends UIComponent {
    constructor({ styles }) {
        const div = document.createElement('div')
        super(div)
        this.configure({ styles })
    }

    configure({ styles }) {
        Object.assign(this.element.style, {
            position: 'fixed',
            top: '80px',
            right: '10px',
            zIndex: '9999',
            padding: '1rem',
            background: 'white',
            border: '1px solid #ccc',
            maxHeight: '70vh',
            overflowY: 'auto',
            width: '300px',
            ...styles
        })
    }

    updateSentences(sentences) {
        this.element.innerHTML = ''
        if (sentences.length === 0) {
            this.element.textContent = 'No buildable sentences found'
            return
        }

        const list = document.createElement('ul')
        Object.assign(list.style, {
            listStyle: 'none',
            padding: '0'
        })

        sentences.forEach(sentence => {
            const item = document.createElement('li')
            Object.assign(item.style, {
                marginBottom: '8px',
                padding: '4px',
                borderBottom: '1px solid #eee'
            })
            item.textContent = sentence.characters
            list.appendChild(item)
        })

        this.element.appendChild(list)
    }
}

// Character Processing
class CharacterProcessor {
    static parseCharacterList(userCharacters) {
        if (!userCharacters) return []

        let characters = userCharacters.trim().split('\n')
            .map(c => c.trim())

        if (characters.length === 1) {
            characters = Array.from(characters[0])
        }

        return [...new Set([
            ...characters.filter(char => char.length > 0),
            ...CONFIG.CHINESE_PUNCTUATION
        ])]
    }

    static findMinMaxSentenceRowNum() {
        const rows = Array.from(document.querySelectorAll('td.px-0.d-print-none'))
            .map(td => parseInt(td.textContent.trim()))
            .filter(row => !isNaN(row))

        return rows.length ? {
            minValue: Math.min(...rows),
            maxValue: Math.max(...rows)
        } : null
    }
}

// Sentence Domain
class Sentence {
    constructor(id, characters) {
        this.id = id
        this.characters = characters
    }

    isConstructibleFrom(characterSet) {
        return Array.from(this.characters)
            .every(char => characterSet.includes(char))
    }
}

class SentenceParser {
    parse(sentenceElement) {
        const chars = Array.from(sentenceElement.querySelectorAll('.cnchar'))
            .map(char => char.textContent.trim())
            .join('')

        return new Sentence(sentenceElement.id, chars)
    }
}

class SentenceHighlighter {
    highlightSentence(sentenceElement) {
        sentenceElement.style.backgroundColor = CONFIG.COLORS.MATCHING_SENTENCE
    }

    highlightCharacters(sentenceElement, characters) {
        const charElements = sentenceElement.querySelectorAll('.cnchar')
        charElements.forEach(char => {
            if (characters.includes(char.textContent.trim())) {
                char.style.backgroundColor = CONFIG.COLORS.MATCHING_CHARACTER
            }
        })
    }
}


// Services
class PageLoader {
    constructor(pageState) {
        this.pageState = pageState
    }

    async loadPages(currentWord, handlePageLoaded) {
        try {
            for (let i = 0; i < CONFIG.LOAD_PAGES_COUNT; i++) {
                await this.loadSentencesAndProcess(currentWord)
                handlePageLoaded()
                await this.delay(CONFIG.REQUEST_DELAY_MS)
            }
        } catch (error) {
            throw new PageLoadError('Failed to load pages', error)
        }
    }

    async loadSentencesAndProcess(currentWord) {
        const nextPage = this.pageState.increment()
        const nextPageUrl = URLUtils.getNextPageUrl(currentWord, nextPage)

        const response = await fetch(nextPageUrl)
        const html = await response.text()
        return this.appendNewContent(html)
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    appendNewContent(html) {
        const tempContainer = document.createElement('div')
        tempContainer.innerHTML = html

        const tableRows = tempContainer.querySelectorAll('.card-body .table tbody tr')
        const targetTable = document.querySelector('.card-body .table tbody')
        const largestId = this.getLargestSentenceId(targetTable)

        tableRows.forEach((row, index) => {
            const newRow = row.cloneNode(true)
            this.updateRowIds(newRow, largestId + index + 1)
            targetTable.appendChild(newRow)
        })
    }

    getLargestSentenceId(table) {
        return Math.max(
            ...Array.from(table.querySelectorAll('[id^="sen"]'))
                .map(el => parseInt(el.id.substring(3))),
            0
        )
    }

    updateRowIds(row, newId) {
        const idPrefixes = {
            'sen': 3,
            'ensen': 5,
            'ppysen': 6
        }

        Object.entries(idPrefixes).forEach(([prefix, length]) => {
            row.querySelectorAll(`[id^="${prefix}"]`).forEach(element => {
                element.id = element.id.substring(0, length) + newId
            })
        })

        this.updateOnClickAttributes(row, newId)
        this.updateRowNumber(row, newId)
    }

    updateOnClickAttributes(row, newId) {
        row.querySelectorAll('[onclick]').forEach(element => {
            const onclick = element.getAttribute('onclick')
            element.setAttribute('onclick',
                onclick.replace(/\(\d+\)/, `(${newId})`)
            )
        })
    }

    updateRowNumber(row, newId) {
        row.querySelector('td.px-0.d-print-none').textContent = newId
    }
}

// UI Manager
class UIManager {
    constructor() {
        this.infoPanel = null
        this.editButton = null
        this.sentencePanel = null
    }

    initialize(onEditClick) {
        this.createInfoPanel()
        this.createEditButton(onEditClick)
        this.createSentencePanel()
    }

    createInfoPanel() {
        this.infoPanel = new InfoPanel({
            text: 'Loading...',
            styles: {
                position: 'fixed',
                top: '10px',
                right: '10px',
                zIndex: '9999',
                padding: '0.25rem',
                background: CONFIG.COLORS.MATCHING_SENTENCE
            }
        })
        this.infoPanel.render()
    }

    createEditButton(onClick) {
        this.editButton = new Button({
            text: 'Edit Character Data',
            onClick,
            styles: {
                position: 'fixed',
                top: '40px',
                right: '10px',
                zIndex: '9999',
                padding: '0.25rem'
            }
        })
        this.editButton.render()
    }

    createSentencePanel() {
        this.sentencePanel = new SentencePanel({
            styles: {
                background: '#fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }
        })
        this.sentencePanel.render()
    }

    updateBuildableSentences(sentences) {
        if (this.sentencePanel) {
            this.sentencePanel.updateSentences(sentences)
        }
    }

    updateSentenceCount(count) {
        if (this.infoPanel) {
            this.infoPanel.updateText(`Found (${count}) sentences`)
        }
    }

    updateFooter(minValue, maxValue) {
        const footer = document.querySelector('.card-footer .pt-2')
        if (footer) {
            footer.textContent = `Displaying ${minValue} to ${maxValue}`
        }
    }
}


// Main Application
class PurpleCultureApp {
    constructor(pageState, pageLoader, uiManager, sentenceParser, sentenceHighlighter, currentWord) {
        this.pageState = pageState
        this.pageLoader = pageLoader
        this.uiManager = uiManager
        this.sentenceParser = sentenceParser
        this.sentenceHighlighter = sentenceHighlighter
        this.currentWord = currentWord

        this.userCharacters = GM_getValue('rawData')
        this.sentences = []
    }

    async initialize() {
        if (!await this.ensureUserData()) {
            console.log('No data provided. Exiting script.')
            return
        }

        this.setupUI()
        await this.loadAndProcessPages()
    }

    handlePageLoaded = () => {
        this.processSentences()
        this.updateDisplay()
    }

    async ensureUserData() {
        if (this.userCharacters) {
            return true
        }

        const userInput = prompt('Paste known characters:')
        if (!userInput) {
            return false
        }

        GM_setValue('rawData', userInput)
        this.userCharacters = userInput
        return true
    }

    setupUI() {
        this.uiManager.initialize(() => this.handleEditUserCharacter())
    }

    async loadAndProcessPages() {
        this.handlePageLoaded()

        await this.pageLoader.loadPages(this.currentWord, this.handlePageLoaded)
    }

    processSentences() {
        const characterSet = CharacterProcessor.parseCharacterList(this.userCharacters)
        const sentenceElements = document.querySelectorAll('.sc.samplesen')

        this.sentences = Array.from(sentenceElements).map(element => {
            this.sentenceHighlighter.highlightCharacters(element, characterSet)

            const sentence = this.sentenceParser.parse(element)

            if (sentence.isConstructibleFrom(characterSet)) {
                this.sentenceHighlighter.highlightSentence(element)
            }

            return sentence
        })


        const buildableSentences = this.sentences
            .filter(s => s.isConstructibleFrom(characterSet))

        this.uiManager.updateSentenceCount(buildableSentences.length)
        this.uiManager.updateBuildableSentences(buildableSentences)
    }

    updateDisplay() {
        const minMax = CharacterProcessor.findMinMaxSentenceRowNum()
        if (minMax) {
            this.uiManager.updateFooter(minMax.minValue, minMax.maxValue)
        }
    }

    handleEditUserCharacter() {
        const userInput = prompt('Enter your characters:', this.userCharacters)
        if (userInput !== null) {
            GM_setValue('rawData', userInput)
            location.reload()
        }
    }
}

// State Management
class PageState {
    constructor(initialPage) {
        this.currentPage = initialPage || 1
    }

    increment() {
        return ++this.currentPage
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    const pageState = new PageState(URLUtils.getPageNumber())
    const pageLoader = new PageLoader(pageState)
    const uiManager = new UIManager()
    const sentenceParser = new SentenceParser()
    const sentenceHighlighter = new SentenceHighlighter()
    const currentWord = URLUtils.getSearchWord()
    const app = new PurpleCultureApp(pageState, pageLoader, uiManager, sentenceParser, sentenceHighlighter, currentWord)
    app.initialize().catch(error => {
        console.error('Application failed to initialize:', error)
    })
})
