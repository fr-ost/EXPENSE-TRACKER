@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.core.Account
import io.github.fr_ost.hisab.core.AccountInput
import io.github.fr_ost.hisab.core.AccountType
import io.github.fr_ost.hisab.core.Category
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.EntryInput
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.data.Outcome

/** The sheet over the screen, for whatever is being added or changed. */
@Composable
fun SheetHost(sheet: Sheet, book: Book, onClose: () -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onClose, sheetState = state) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 32.dp)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            key(sheet) {
                when (sheet) {
                    is Sheet.NewTransaction -> TransactionEditor(book, null, sheet.accountId, onClose)
                    is Sheet.EditTransaction -> TransactionEditor(book, sheet.id, null, onClose)
                    Sheet.NewAccount -> AccountEditor(book, null, onClose)
                    is Sheet.EditAccount -> AccountEditor(book, sheet.id, onClose)
                    is Sheet.UpdateBalance -> BalanceEditor(book, sheet.accountId, onClose)
                }
            }
        }
    }
}

/** Adding or changing an entry: spending, income or a transfer. */
@Composable
private fun ColumnScope.TransactionEditor(book: Book, id: String?, presetAccount: String?, onClose: () -> Unit) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val existing = id?.let { key -> book.live.transactions.firstOrNull { it.id == key } }
    if (id != null && existing == null) {
        Text("This entry is gone.", style = MaterialTheme.typography.bodyLarge)
        return
    }
    val usable = book.live.accounts.filter { it.isActive || it.id == existing?.accountId || it.id == existing?.toAccountId }

    fun defaultAccount(type: EntryType): String? {
        if (presetAccount != null) return presetAccount
        val remembered = repository.recall("account:${type.name}")?.takeIf { key -> usable.any { it.id == key } }
        if (remembered != null) return remembered
        val currency = when (type) {
            EntryType.INCOME -> book.settings.incomeCurrency
            EntryType.EXPENSE -> book.settings.expenseCurrency
            else -> null
        } ?: book.settings.baseCurrency
        return (usable.firstOrNull { it.currency == currency } ?: usable.firstOrNull())?.id
    }

    var type by remember { mutableStateOf(existing?.type?.takeIf { it != EntryType.ADJUSTMENT } ?: EntryType.EXPENSE) }
    var amount by remember { mutableStateOf(existing?.let { Money.editable(it.amount) } ?: "") }
    var accountId by remember { mutableStateOf(existing?.accountId ?: defaultAccount(type)) }
    var accountChosen by remember { mutableStateOf(existing != null || presetAccount != null) }
    var toAccountId by remember { mutableStateOf(existing?.toAccountId) }
    var toAmount by remember { mutableStateOf(existing?.toAmount?.let(Money::editable) ?: "") }
    var categoryId by remember { mutableStateOf(existing?.categoryId) }
    var scope by remember { mutableStateOf(existing?.scope ?: ExpenseScope.PERSONAL) }
    var countAsExpense by remember { mutableStateOf(existing?.countAsExpense ?: false) }
    var date by remember { mutableStateOf(existing?.date ?: book.today) }
    var time by remember { mutableStateOf(existing?.time) }
    var description by remember { mutableStateOf(existing?.description ?: "") }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var affectsBalance by remember { mutableStateOf(existing?.affectsBalance ?: true) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    var confirmDelete by remember { mutableStateOf(false) }

    val from = book.accounts[accountId]
    val to = book.accounts[toAccountId]
    val kind = if (type == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE
    val categories = book.live.categories.filter { it.kind == kind && (!it.isArchived || it.id == existing?.categoryId) }.sortedBy { it.sortOrder }
    val spending = type == EntryType.EXPENSE || (type == EntryType.TRANSFER && countAsExpense)

    Text(if (existing == null) "New entry" else "Edit entry", style = MaterialTheme.typography.titleLarge)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        val types = listOf(EntryType.EXPENSE to "Spending", EntryType.INCOME to "Income", EntryType.TRANSFER to "Transfer")
        types.forEachIndexed { index, (value, label) ->
            SegmentedButton(selected = type == value, onClick = {
                if (type != value) {
                    type = value
                    // A new entry starts on the account usual for its kind, until one is picked by hand.
                    if (!accountChosen) accountId = defaultAccount(value)
                    if (book.categories[categoryId]?.kind != (if (value == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE)) categoryId = null
                }
            }, shape = SegmentedButtonDefaults.itemShape(index, types.size)) { Text(label) }
        }
    }
    AmountField("Amount", amount, { amount = it }, error = errors["amount"], prefix = Money.symbol(from?.currency ?: book.format.base))
    PickerField(if (type == EntryType.TRANSFER) "From" else "Account", from, usable, { accountLabel(it, book) }, {
        accountId = it.id
        accountChosen = true
    }, error = errors["accountId"])
    if (type == EntryType.TRANSFER) {
        PickerField("To", to, usable.filter { it.id != accountId }, { accountLabel(it, book) }, { toAccountId = it.id }, error = errors["toAccountId"])
        if (from != null && to != null && from.currency != to.currency) {
            AmountField("Amount received (${to.currency})", toAmount, { toAmount = it }, error = errors["toAmount"], prefix = Money.symbol(to.currency))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Count as spending", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = countAsExpense, onCheckedChange = { countAsExpense = it })
        }
        if (countAsExpense) Text("For paying a card or someone else's account: it counts in spending as well.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (type != EntryType.TRANSFER || countAsExpense) {
        PickerField("Category", book.categories[categoryId]?.takeIf { it.kind == kind }, categories, { it.name }, {
            categoryId = it.id
            it.defaultScope?.let { s -> scope = s }
        }, error = errors["categoryId"])
    }
    if (spending) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("For", style = MaterialTheme.typography.bodyLarge)
            FilterChip(selected = scope == ExpenseScope.PERSONAL, onClick = { scope = ExpenseScope.PERSONAL }, label = { Text("Personal") })
            FilterChip(selected = scope == ExpenseScope.FAMILY, onClick = { scope = ExpenseScope.FAMILY }, label = { Text("Family") })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        DateField("Date", date, { date = it }, Modifier.weight(1f), error = errors["date"])
        TimeField("Time", time, { time = it }, Modifier.weight(1f), error = errors["time"])
    }
    OutlinedTextField(description, { description = it.take(140) }, label = { Text("Description") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        isError = errors["description"] != null)
    OutlinedTextField(notes, { notes = it.take(2000) }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Counts in balances", style = MaterialTheme.typography.bodyLarge)
            Text("Off: kept in reports, but no balance moves.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = affectsBalance, onCheckedChange = { affectsBalance = it })
    }
    errors[""]?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (existing != null) TextButton(onClick = { confirmDelete = true }) { Text("Delete") }
        Row(Modifier.weight(1f)) {}
        TextButton(onClick = onClose) { Text("Cancel") }
        Button(onClick = {
            val input = EntryInput(
                type = type,
                amount = Money.parseInput(amount) ?: 0,
                date = date,
                time = time,
                accountId = accountId ?: "",
                toAccountId = if (type == EntryType.TRANSFER) toAccountId else null,
                toAmount = if (type == EntryType.TRANSFER) Money.parseInput(toAmount) else null,
                categoryId = if (type != EntryType.TRANSFER || countAsExpense) categoryId else null,
                scope = if (spending) scope else null,
                countAsExpense = type == EntryType.TRANSFER && countAsExpense,
                description = description,
                notes = notes,
                affectsBalance = affectsBalance,
            )
            val clock = repository.clock()
            when (val outcome = repository.edit { data -> listOf(if (existing == null) Edits.addTransaction(data, input, clock) else Edits.updateTransaction(data, existing.id, input, clock)) }) {
                Outcome.Done -> {
                    if (accountChosen && accountId != null) repository.remember("account:${type.name}", accountId)
                    messages.show(if (existing == null) "Added" else "Saved")
                    onClose()
                }
                is Outcome.Refused -> errors = mapOf((outcome.field ?: "") to outcome.message)
            }
        }) { Text(if (existing == null) "Add" else "Save") }
    }

    if (confirmDelete && existing != null) {
        Confirm("Delete this entry?", "It is removed from your ledger${if (existing.smsKey != null) ", with the balance its SMS reported" else ""}.", "Delete", onConfirm = {
            repository.edit { Edits.deleteTransaction(it, existing.id) }
            messages.show("Deleted")
            confirmDelete = false
            onClose()
        }, onDismiss = { confirmDelete = false })
    }
}

private fun accountLabel(account: Account, book: Book): String {
    val balance = book.summaries.firstOrNull { it.account.id == account.id }?.balance
    return if (balance == null) account.name else "${account.name} · ${book.format.money(balance, account.currency)}"
}

/** Adding or changing an account. */
@Composable
private fun ColumnScope.AccountEditor(book: Book, id: String?, onClose: () -> Unit) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val navigator = LocalNavigator.current
    val existing = id?.let { book.accounts[it] }
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var type by remember { mutableStateOf(existing?.type ?: AccountType.CASH) }
    var currency by remember { mutableStateOf(existing?.currency ?: book.settings.baseCurrency) }
    var opening by remember { mutableStateOf(existing?.let { Money.editable(it.openingBalance) } ?: "") }
    var openingDate by remember { mutableStateOf(existing?.openingDate ?: book.today) }
    var active by remember { mutableStateOf(existing?.isActive ?: true) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }

    Text(if (existing == null) "New account" else "Edit account", style = MaterialTheme.typography.titleLarge)
    OutlinedTextField(name, { name = it.take(60) }, label = { Text("Name") }, placeholder = { Text("e.g. bKash, City Bank 4567, Cash") }, singleLine = true,
        isError = errors["name"] != null, supportingText = errors["name"]?.let { { Text(it) } }, modifier = Modifier.fillMaxWidth())
    PickerField("Type", type, AccountType.entries, Format::accountType, { type = it })
    PickerField("Currency", currency, (Format.CURRENCIES + currency).distinct(), { it }, { currency = it }, error = errors["currency"])
    AmountField(if (existing == null) "What it holds now" else "Opening balance", opening, { opening = it }, error = errors["openingBalance"], prefix = Money.symbol(currency), allowNegative = true)
    DateField("On", openingDate, { openingDate = it }, error = errors["openingDate"])
    Text("Entries from before this date are history: they never change the balance after it.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (existing != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Active", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = active, onCheckedChange = { active = it })
        }
    }
    errors[""]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.weight(1f)) {}
        TextButton(onClick = onClose) { Text("Cancel") }
        Button(onClick = {
            val parsed = if (opening.isBlank()) 0L else Money.parse(opening)
            if (parsed == null) {
                errors = mapOf("openingBalance" to "Enter an amount.")
                return@Button
            }
            var savedId: String? = null
            val outcome = repository.edit { data ->
                listOf(Edits.saveAccount(data, AccountInput(name, type, currency, parsed, openingDate, active, existing?.icon, existing?.color), id).also { savedId = it.id })
            }
            when (outcome) {
                Outcome.Done -> {
                    messages.show(if (existing == null) "Account added" else "Saved")
                    onClose()
                    if (existing == null) savedId?.let { navigator.open(Screen.AccountDetail(it)) }
                }
                is Outcome.Refused -> errors = mapOf((outcome.field ?: "") to outcome.message)
            }
        }) { Text(if (existing == null) "Add" else "Save") }
    }
}

/** "This account holds X": the ledger is corrected to agree. */
@Composable
private fun ColumnScope.BalanceEditor(book: Book, accountId: String, onClose: () -> Unit) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val account = book.accounts[accountId] ?: return
    var balance by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(book.today) }
    var time by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val clock = remember { repository.clock() }
    val recorded = remember(book, date, time) {
        runCatching { Edits.recordedBalanceAt(book.live, accountId, date, time, clock) }.getOrNull()
    }
    val entered = Money.parse(balance)

    Text("Update balance", style = MaterialTheme.typography.titleLarge)
    Text("What does ${account.name} hold? Hisab corrects its record to agree; entries from before then never change it again.",
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    AmountField("Balance", balance, { balance = it }, error = errors["balance"], prefix = Money.symbol(account.currency), allowNegative = true)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        DateField("Date", date, { date = it }, Modifier.weight(1f), error = errors["date"])
        TimeField("Time", time, { time = it }, Modifier.weight(1f), error = errors["time"])
    }
    if (recorded != null) {
        val difference = entered?.let { it - recorded }
        Text(
            "Hisab shows ${book.format.money(recorded, account.currency)}" +
                (if (difference != null && difference != 0L) " — a difference of ${book.format.money(difference, account.currency, Money.Sign.ALWAYS)}" else ""),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    OutlinedTextField(note, { note = it.take(500) }, label = { Text("Note") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    errors[""]?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.weight(1f)) {}
        TextButton(onClick = onClose) { Text("Cancel") }
        Button(onClick = {
            val amount = entered ?: run {
                errors = mapOf("balance" to "Enter the balance.")
                return@Button
            }
            when (val outcome = repository.edit { data -> listOf(Edits.updateBalance(data, accountId, amount, date, time, repository.clock(), note)) }) {
                Outcome.Done -> {
                    messages.show("Balance updated")
                    onClose()
                }
                is Outcome.Refused -> errors = mapOf((outcome.field ?: "") to outcome.message)
            }
        }) { Text("Save") }
    }
}

/** A category to choose for something, shown by name. */
fun categoryName(category: Category?): String = category?.name ?: "No category"
